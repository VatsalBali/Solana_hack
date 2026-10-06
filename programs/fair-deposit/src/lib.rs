use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("5w8Zb7EUDZNaUGo4NGBgN3scdFisZj4rDmv4qvCTrY5e");

/// Fair Deposit: a rental deposit held in escrow.
///
/// Flow:
/// 1. Tenant locks the deposit (`create_deposit`). Nobody can move it alone.
/// 2. Before `refund_after`, the landlord proposes how much goes back (`propose_split`).
/// 3. Tenant accepts (`approve`) or either side escalates (`dispute`).
/// 4. A disputed deposit is split by the mediator (`resolve`).
/// 5. If the landlord never proposes, the tenant takes everything back after
///    `refund_after` (`claim_after_timeout`).
///
/// Every settlement updates the tenant's on-chain `TenantRecord`.
#[program]
pub mod fair_deposit {
    use super::*;

    pub fn create_deposit(
        ctx: Context<CreateDeposit>,
        lease_id: u64,
        amount: u64,
        refund_after: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(amount > 0, FairError::ZeroAmount);
        require!(refund_after > now, FairError::DeadlineInPast);

        let tenant = ctx.accounts.tenant.key();
        let landlord = ctx.accounts.landlord.key();
        let mediator = ctx.accounts.mediator.key();
        require_keys_neq!(tenant, landlord, FairError::SameParty);
        require_keys_neq!(mediator, tenant, FairError::SameParty);
        require_keys_neq!(mediator, landlord, FairError::SameParty);

        ctx.accounts.lease.set_inner(Lease {
            tenant,
            landlord,
            mediator,
            mint: ctx.accounts.mint.key(),
            lease_id,
            amount,
            created_at: now,
            refund_after,
            proposed_tenant_amount: 0,
            tenant_received: 0,
            settled_at: 0,
            status: Status::Active,
            outcome: Outcome::None,
            bump: ctx.bumps.lease,
            vault_bump: ctx.bumps.vault,
        });

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.tenant_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.tenant.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let record = &mut ctx.accounts.record;
        if record.tenant == Pubkey::default() {
            record.tenant = tenant;
            record.bump = ctx.bumps.record;
        }
        record.deposits = record.deposits.checked_add(1).ok_or(FairError::Overflow)?;
        record.total_deposited = record
            .total_deposited
            .checked_add(amount)
            .ok_or(FairError::Overflow)?;

        emit!(DepositLocked { lease: ctx.accounts.lease.key(), tenant, landlord, amount, refund_after });
        Ok(())
    }

    /// Landlord says how much of the deposit goes back to the tenant.
    /// Can be revised until the tenant answers, but only before `refund_after`.
    pub fn propose_split(ctx: Context<ProposeSplit>, tenant_amount: u64) -> Result<()> {
        let lease = &mut ctx.accounts.lease;
        let now = Clock::get()?.unix_timestamp;
        require!(
            matches!(lease.status, Status::Active | Status::Proposed),
            FairError::WrongStatus
        );
        require!(now < lease.refund_after, FairError::DeadlinePassed);
        require!(tenant_amount <= lease.amount, FairError::TooMuch);

        lease.proposed_tenant_amount = tenant_amount;
        lease.status = Status::Proposed;
        emit!(SplitProposed { lease: lease.key(), tenant_amount });
        Ok(())
    }

    /// Tenant accepts the landlord's proposal; funds are paid out immediately.
    pub fn approve(ctx: Context<Settle>) -> Result<()> {
        let lease = &ctx.accounts.lease;
        require_keys_eq!(ctx.accounts.signer.key(), lease.tenant, FairError::Unauthorized);
        require!(lease.status == Status::Proposed, FairError::WrongStatus);
        let tenant_amount = lease.proposed_tenant_amount;
        settle(ctx, tenant_amount, Outcome::Agreed)
    }

    /// Tenant or landlord escalates to the mediator.
    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let lease = &mut ctx.accounts.lease;
        let who = ctx.accounts.signer.key();
        require!(who == lease.tenant || who == lease.landlord, FairError::Unauthorized);
        require!(
            matches!(lease.status, Status::Active | Status::Proposed),
            FairError::WrongStatus
        );
        lease.status = Status::Disputed;
        emit!(Disputed { lease: lease.key(), by: who });
        Ok(())
    }

    /// Mediator decides the split of a disputed deposit.
    pub fn resolve(ctx: Context<Settle>, tenant_amount: u64) -> Result<()> {
        let lease = &ctx.accounts.lease;
        require_keys_eq!(ctx.accounts.signer.key(), lease.mediator, FairError::Unauthorized);
        require!(lease.status == Status::Disputed, FairError::WrongStatus);
        require!(tenant_amount <= lease.amount, FairError::TooMuch);
        settle(ctx, tenant_amount, Outcome::Mediated)
    }

    /// Landlord stayed silent past the deadline: the tenant gets everything back.
    pub fn claim_after_timeout(ctx: Context<Settle>) -> Result<()> {
        let lease = &ctx.accounts.lease;
        require_keys_eq!(ctx.accounts.signer.key(), lease.tenant, FairError::Unauthorized);
        require!(lease.status == Status::Active, FairError::WrongStatus);
        require!(
            Clock::get()?.unix_timestamp >= lease.refund_after,
            FairError::TooEarly
        );
        let amount = lease.amount;
        settle(ctx, amount, Outcome::TimedOut)
    }
}

/// Pays the vault out (tenant share + landlord remainder), closes the vault,
/// marks the lease settled and updates the tenant record.
fn settle(ctx: Context<Settle>, tenant_amount: u64, outcome: Outcome) -> Result<()> {
    let lease = &ctx.accounts.lease;
    let landlord_amount = lease.amount.checked_sub(tenant_amount).ok_or(FairError::TooMuch)?;
    let lease_id = lease.lease_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"lease", lease.tenant.as_ref(), &lease_id, &[lease.bump]];
    let signer = &[seeds];
    let decimals = ctx.accounts.mint.decimals;

    for (to, amount) in [
        (ctx.accounts.tenant_token.to_account_info(), tenant_amount),
        (ctx.accounts.landlord_token.to_account_info(), landlord_amount),
    ] {
        if amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to,
                        authority: ctx.accounts.lease.to_account_info(),
                    },
                    signer,
                ),
                amount,
                decimals,
            )?;
        }
    }

    // Vault rent goes back to the tenant, who paid for it.
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.tenant.to_account_info(),
            authority: ctx.accounts.lease.to_account_info(),
        },
        signer,
    ))?;

    let now = Clock::get()?.unix_timestamp;
    let lease = &mut ctx.accounts.lease;
    lease.status = Status::Settled;
    lease.outcome = outcome;
    lease.tenant_received = tenant_amount;
    lease.settled_at = now;

    let record = &mut ctx.accounts.record;
    record.settled = record.settled.checked_add(1).ok_or(FairError::Overflow)?;
    record.total_returned = record
        .total_returned
        .checked_add(tenant_amount)
        .ok_or(FairError::Overflow)?;
    if tenant_amount == lease.amount {
        record.full_refunds += 1;
    }
    if outcome == Outcome::Mediated {
        record.disputes += 1;
    }

    emit!(DepositSettled { lease: lease.key(), tenant_amount, landlord_amount, outcome });
    Ok(())
}

#[derive(Accounts)]
#[instruction(lease_id: u64)]
pub struct CreateDeposit<'info> {
    #[account(mut)]
    pub tenant: Signer<'info>,
    /// CHECK: only stored as the landlord's address.
    pub landlord: UncheckedAccount<'info>,
    /// CHECK: only stored as the mediator's address.
    pub mediator: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = tenant,
        space = 8 + Lease::INIT_SPACE,
        seeds = [b"lease", tenant.key().as_ref(), &lease_id.to_le_bytes()],
        bump,
    )]
    pub lease: Account<'info, Lease>,
    #[account(
        init,
        payer = tenant,
        seeds = [b"vault", lease.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = lease,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = tenant,
        token::token_program = token_program,
    )]
    pub tenant_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = tenant,
        space = 8 + TenantRecord::INIT_SPACE,
        seeds = [b"record", tenant.key().as_ref()],
        bump,
    )]
    pub record: Account<'info, TenantRecord>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeSplit<'info> {
    pub landlord: Signer<'info>,
    #[account(mut, has_one = landlord @ FairError::Unauthorized)]
    pub lease: Account<'info, Lease>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub lease: Account<'info, Lease>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub signer: Signer<'info>,
    #[account(mut, has_one = tenant, has_one = landlord, has_one = mint)]
    pub lease: Account<'info, Lease>,
    /// CHECK: matched against `lease.tenant`; receives the vault rent.
    #[account(mut)]
    pub tenant: UncheckedAccount<'info>,
    /// CHECK: matched against `lease.landlord`.
    pub landlord: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", lease.key().as_ref()],
        bump = lease.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = tenant,
        token::token_program = token_program,
    )]
    pub tenant_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = landlord,
        token::token_program = token_program,
    )]
    pub landlord_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"record", tenant.key().as_ref()], bump = record.bump)]
    pub record: Account<'info, TenantRecord>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Lease {
    pub tenant: Pubkey,
    pub landlord: Pubkey,
    pub mediator: Pubkey,
    pub mint: Pubkey,
    pub lease_id: u64,
    pub amount: u64,
    pub created_at: i64,
    /// After this time, if the landlord has not proposed a split,
    /// the tenant can take the whole deposit back.
    pub refund_after: i64,
    pub proposed_tenant_amount: u64,
    pub tenant_received: u64,
    pub settled_at: i64,
    pub status: Status,
    pub outcome: Outcome,
    pub bump: u8,
    pub vault_bump: u8,
}

/// A tenant's portable rental history, one per wallet.
#[account]
#[derive(InitSpace)]
pub struct TenantRecord {
    pub tenant: Pubkey,
    pub deposits: u32,
    pub settled: u32,
    pub full_refunds: u32,
    pub disputes: u32,
    pub total_deposited: u64,
    pub total_returned: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Status {
    Active,
    Proposed,
    Disputed,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    None,
    Agreed,
    Mediated,
    TimedOut,
}

#[event]
pub struct DepositLocked {
    pub lease: Pubkey,
    pub tenant: Pubkey,
    pub landlord: Pubkey,
    pub amount: u64,
    pub refund_after: i64,
}

#[event]
pub struct SplitProposed {
    pub lease: Pubkey,
    pub tenant_amount: u64,
}

#[event]
pub struct Disputed {
    pub lease: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct DepositSettled {
    pub lease: Pubkey,
    pub tenant_amount: u64,
    pub landlord_amount: u64,
    pub outcome: Outcome,
}

#[error_code]
pub enum FairError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("Refund deadline must be in the future")]
    DeadlineInPast,
    #[msg("Tenant, landlord and mediator must be different wallets")]
    SameParty,
    #[msg("Only the right party can do this")]
    Unauthorized,
    #[msg("The deposit is not in the right state for this action")]
    WrongStatus,
    #[msg("The landlord's deadline has passed")]
    DeadlinePassed,
    #[msg("The refund deadline has not passed yet")]
    TooEarly,
    #[msg("Amount is larger than the deposit")]
    TooMuch,
    #[msg("Arithmetic overflow")]
    Overflow,
}

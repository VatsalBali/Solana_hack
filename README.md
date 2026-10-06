# Tessera

Rental deposits in a neutral Solana escrow. Fair deposits, provable history.

*Tessera*: in ancient Rome, host and guest broke a token in two and each kept half as proof of trust.

Today the landlord holds the deposit, decides how much to keep, and the tenant waits. Tessera locks the deposit in USDC in an on-chain escrow that neither side can move alone:

1. **Lock.** The tenant deposits USDC into a vault owned by the program.
2. **Agree.** After move-out, the landlord proposes how much goes back. The tenant approves and the money is paid out instantly.
3. **Mediate.** If either side disputes, a mediator chosen at the start decides the split.
4. **Timeout.** If the landlord stays silent past the deadline, the tenant takes the full deposit back.

Every settlement updates the tenant's **on-chain record** (deposits, full refunds, disputes, amount returned), a rental history the tenant can show the next landlord, which nobody can edit.

**Live on Solana devnet:** program [`5w8Zb7EUDZNaUGo4NGBgN3scdFisZj4rDmv4qvCTrY5e`](https://explorer.solana.com/address/5w8Zb7EUDZNaUGo4NGBgN3scdFisZj4rDmv4qvCTrY5e?cluster=devnet)

Built at the SolanaCZE Build Station, Prague, for Colosseum's Crypto World's Fair (October 2026).

## Repository

| Path | What it is |
|---|---|
| `programs/fair-deposit/src/lib.rs` | The Anchor escrow program |
| `tests/` | Program tests (`anchor test`) |
| `app/` | React web app (Vite) for the demo |
| `app/scripts/setup-demo.mjs` | Creates devnet demo wallets and a test USDC mint |

## Program

| Instruction | Who | What it does |
|---|---|---|
| `create_deposit(lease_id, amount, refund_after)` | Tenant | Creates the lease, moves USDC into the vault PDA, opens or updates the tenant record |
| `propose_split(tenant_amount)` | Landlord | Proposes how much returns to the tenant; only before `refund_after` |
| `approve` | Tenant | Accepts the proposal, pays both sides, closes the vault |
| `dispute` | Tenant or landlord | Hands the decision to the mediator |
| `resolve(tenant_amount)` | Mediator | Decides the split of a disputed deposit |
| `claim_after_timeout` | Tenant | Full refund if the landlord never proposed before `refund_after` |

Accounts: `Lease` (PDA `["lease", tenant, lease_id]`), vault token account (PDA `["vault", lease]`, owned by the lease PDA), `TenantRecord` (PDA `["record", tenant]`). Works with SPL Token and Token-2022 mints.

## Run it

Requirements: Rust, Solana CLI, Anchor CLI (on Windows, use WSL), Node 20+.

```bash
anchor build
anchor test            # local validator
anchor deploy --provider.cluster devnet
```

Web app:

```bash
cd app
npm install
node scripts/setup-demo.mjs ~/.config/solana/id.json   # devnet wallets + test USDC, writes app/.env.local
npm run dev
```

The demo app uses three devnet test wallets (tenant, landlord, mediator) so one person can play every role. They hold only devnet SOL and test USDC.

## Roadmap

- Real wallets (Phantom, Solflare) and an invite link for the landlord
- Photo evidence and move-in/move-out checklists attached to the lease
- Mediator marketplace and fees
- Pilot with Prague student landlords

import { AnchorProvider, BN, Program, type IdlAccounts } from '@anchor-lang/core'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import idl from './idl/fair_deposit.json'
import type { FairDeposit } from './idl/fair_deposit'

export type Lease = IdlAccounts<FairDeposit>['lease']
export type TenantRecord = IdlAccounts<FairDeposit>['tenantRecord']
export type LeaseWithKey = { publicKey: PublicKey; account: Lease }
export type Role = 'tenant' | 'landlord' | 'mediator'

export const DECIMALS = 6
export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com'
export const connection = new Connection(RPC_URL, 'confirmed')
export const PROGRAM_ID = new PublicKey(idl.address)

function loadKeypair(secret: string | undefined): Keypair | null {
  if (!secret) return null
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)))
  } catch {
    return null
  }
}

// Demo wallets for devnet, created by scripts/setup-demo.mjs (kept out of git).
export const wallets: Record<Role, Keypair | null> = {
  tenant: loadKeypair(import.meta.env.VITE_TENANT_SECRET),
  landlord: loadKeypair(import.meta.env.VITE_LANDLORD_SECRET),
  mediator: loadKeypair(import.meta.env.VITE_MEDIATOR_SECRET),
}
export const MINT = import.meta.env.VITE_MINT ? new PublicKey(import.meta.env.VITE_MINT) : null
export const isConfigured = Boolean(MINT && wallets.tenant && wallets.landlord && wallets.mediator)

class KeypairWallet {
  readonly payer: Keypair
  constructor(payer: Keypair) {
    this.payer = payer
  }
  get publicKey() {
    return this.payer.publicKey
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer])
    else tx.partialSign(this.payer)
    return tx
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)))
  }
}

export function programFor(kp: Keypair) {
  const provider = new AnchorProvider(connection, new KeypairWallet(kp), { commitment: 'confirmed' })
  return new Program<FairDeposit>(idl as FairDeposit, provider)
}

// Read-only access (fetching accounts) does not need a signer.
export const reader = programFor(Keypair.generate())

export const leasePda = (tenant: PublicKey, leaseId: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('lease'), tenant.toBuffer(), leaseId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID,
  )[0]
export const vaultPda = (lease: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), lease.toBuffer()], PROGRAM_ID)[0]
export const recordPda = (tenant: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('record'), tenant.toBuffer()], PROGRAM_ID)[0]
export const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner)

export const toUnits = (usdc: number) => new BN(Math.round(usdc * 10 ** DECIMALS))
export const fromUnits = (units: BN | number) => Number(units.toString()) / 10 ** DECIMALS
export const fmtUsdc = (units: BN | number) =>
  fromUnits(units).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const statusOf = (lease: Lease) => Object.keys(lease.status)[0] as 'active' | 'proposed' | 'disputed' | 'settled'
export const outcomeOf = (lease: Lease) => Object.keys(lease.outcome)[0] as 'none' | 'agreed' | 'mediated' | 'timedOut'

export async function balances(owner: PublicKey) {
  const sol = (await connection.getBalance(owner)) / LAMPORTS_PER_SOL
  const [usdc] = await usdcBalances([owner])
  return { sol, usdc }
}

/** Test-USDC balances for several wallets in a single RPC call (public devnet rate-limits hard). */
export async function usdcBalances(owners: PublicKey[]): Promise<number[]> {
  if (!MINT) return owners.map(() => 0)
  const infos = await connection.getMultipleParsedAccounts(owners.map((o) => ata(o, MINT)))
  return infos.value.map((info) => {
    const data = info?.data
    return data && 'parsed' in data ? Number(data.parsed.info.tokenAmount.uiAmount ?? 0) : 0
  })
}

export async function fetchLeases(): Promise<LeaseWithKey[]> {
  // Only this demo's deposits: the tenant pubkey sits right after the 8-byte discriminator.
  const all = wallets.tenant
    ? await reader.account.lease.all([{ memcmp: { offset: 8, bytes: wallets.tenant.publicKey.toBase58() } }])
    : []
  return all.sort((a, b) => b.account.createdAt.cmp(a.account.createdAt))
}

export const fetchRecord = (tenant: PublicKey) => reader.account.tenantRecord.fetchNullable(recordPda(tenant))

export async function createDeposit(tenant: Keypair, landlord: PublicKey, mediator: PublicKey, usdc: number, refundAfter: number) {
  if (!MINT) throw new Error('Demo mint is not configured')
  const leaseId = new BN(Date.now())
  const lease = leasePda(tenant.publicKey, leaseId)
  return programFor(tenant)
    .methods.createDeposit(leaseId, toUnits(usdc), new BN(refundAfter))
    .accountsPartial({
      tenant: tenant.publicKey,
      landlord,
      mediator,
      mint: MINT,
      lease,
      vault: vaultPda(lease),
      tenantToken: ata(tenant.publicKey, MINT),
      record: recordPda(tenant.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
}

export function proposeSplit(landlord: Keypair, lease: PublicKey, tenantUsdc: number) {
  return programFor(landlord)
    .methods.proposeSplit(toUnits(tenantUsdc))
    .accountsPartial({ landlord: landlord.publicKey, lease })
    .rpc()
}

export function dispute(signer: Keypair, lease: PublicKey) {
  return programFor(signer).methods.dispute().accountsPartial({ signer: signer.publicKey, lease }).rpc()
}

// approve, resolve and claim_after_timeout share the same payout accounts.
function settleAccounts(signer: Keypair, { publicKey, account }: LeaseWithKey) {
  return {
    signer: signer.publicKey,
    lease: publicKey,
    tenant: account.tenant,
    landlord: account.landlord,
    mint: account.mint,
    vault: vaultPda(publicKey),
    tenantToken: ata(account.tenant, account.mint),
    landlordToken: ata(account.landlord, account.mint),
    record: recordPda(account.tenant),
    tokenProgram: TOKEN_PROGRAM_ID,
  }
}

// The landlord may never have held the token; create their account if needed.
const ensureLandlordAta = (signer: Keypair, { account }: LeaseWithKey) => [
  createAssociatedTokenAccountIdempotentInstruction(
    signer.publicKey,
    ata(account.landlord, account.mint),
    account.landlord,
    account.mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ),
]

export function approve(tenant: Keypair, lease: LeaseWithKey) {
  return programFor(tenant)
    .methods.approve()
    .accountsPartial(settleAccounts(tenant, lease))
    .preInstructions(ensureLandlordAta(tenant, lease))
    .rpc()
}

export function resolve(mediator: Keypair, lease: LeaseWithKey, tenantUsdc: number) {
  return programFor(mediator)
    .methods.resolve(toUnits(tenantUsdc))
    .accountsPartial(settleAccounts(mediator, lease))
    .preInstructions(ensureLandlordAta(mediator, lease))
    .rpc()
}

export function claimAfterTimeout(tenant: Keypair, lease: LeaseWithKey) {
  return programFor(tenant)
    .methods.claimAfterTimeout()
    .accountsPartial(settleAccounts(tenant, lease))
    .preInstructions(ensureLandlordAta(tenant, lease))
    .rpc()
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
export const explorerAddr = (a: PublicKey) => `https://explorer.solana.com/address/${a.toBase58()}?cluster=devnet`
export const short = (a: PublicKey) => `${a.toBase58().slice(0, 4)}…${a.toBase58().slice(-4)}`

/** Turns Anchor/RPC errors into one readable line. */
export function errorText(e: unknown): string {
  const err = e as { error?: { errorMessage?: string }; message?: string }
  return err?.error?.errorMessage ?? err?.message?.split('\n')[0] ?? String(e)
}

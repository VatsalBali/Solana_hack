import * as anchor from '@anchor-lang/core'
import { BN, Program } from '@anchor-lang/core'
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { FairDeposit } from '../target/types/fair_deposit'

const USDC = 1_000_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('fair-deposit', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.fairDeposit as Program<FairDeposit>
  const conn = provider.connection
  const payer = (provider.wallet as anchor.Wallet).payer

  const tenant = Keypair.generate()
  const landlord = Keypair.generate()
  const mediator = Keypair.generate()
  const stranger = Keypair.generate()
  let mint: PublicKey
  let tenantAta: PublicKey
  let landlordAta: PublicKey
  let nextId = 1

  const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0]
  const recordPda = pda([Buffer.from('record'), tenant.publicKey.toBuffer()])
  const balance = async (a: PublicKey) => Number((await getAccount(conn, a)).amount)

  async function lock(amount: number, refundAfter: number) {
    const leaseId = new BN(nextId++)
    const lease = pda([Buffer.from('lease'), tenant.publicKey.toBuffer(), leaseId.toArrayLike(Buffer, 'le', 8)])
    const vault = pda([Buffer.from('vault'), lease.toBuffer()])
    await program.methods
      .createDeposit(leaseId, new BN(amount), new BN(refundAfter))
      .accountsPartial({
        tenant: tenant.publicKey,
        landlord: landlord.publicKey,
        mediator: mediator.publicKey,
        mint,
        lease,
        vault,
        tenantToken: tenantAta,
        record: recordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([tenant])
      .rpc()
    return { lease, vault }
  }

  const settleAccounts = (signer: Keypair, lease: PublicKey, vault: PublicKey) => ({
    signer: signer.publicKey,
    lease,
    tenant: tenant.publicKey,
    landlord: landlord.publicKey,
    mint,
    vault,
    tenantToken: tenantAta,
    landlordToken: landlordAta,
    record: recordPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })

  const now = () => Math.floor(Date.now() / 1000)

  before(async () => {
    for (const kp of [tenant, landlord, mediator, stranger]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL)
      await conn.confirmTransaction(sig)
    }
    mint = await createMint(conn, payer, payer.publicKey, null, 6)
    tenantAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, tenant.publicKey)).address
    landlordAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, landlord.publicKey)).address
    await mintTo(conn, payer, mint, tenantAta, payer, 10_000 * USDC)
  })

  it('locks the deposit and pays out an agreed split', async () => {
    const { lease, vault } = await lock(1200 * USDC, now() + 3600)
    assert.equal(await balance(vault), 1200 * USDC)

    await program.methods.proposeSplit(new BN(1000 * USDC))
      .accountsPartial({ landlord: landlord.publicKey, lease }).signers([landlord]).rpc()

    const before = await balance(tenantAta)
    await program.methods.approve()
      .accountsPartial(settleAccounts(tenant, lease, vault)).signers([tenant]).rpc()

    assert.equal((await balance(tenantAta)) - before, 1000 * USDC)
    assert.equal(await balance(landlordAta), 200 * USDC)
    assert.isNull(await conn.getAccountInfo(vault), 'vault is closed')
    const l = await program.account.lease.fetch(lease)
    assert.deepEqual(l.status, { settled: {} })
    assert.deepEqual(l.outcome, { agreed: {} })
  })

  it('rejects actions from the wrong party', async () => {
    const { lease, vault } = await lock(100 * USDC, now() + 3600)
    try {
      await program.methods.proposeSplit(new BN(0))
        .accountsPartial({ landlord: stranger.publicKey, lease }).signers([stranger]).rpc()
      assert.fail('stranger proposed a split')
    } catch (e: any) {
      assert.include(String(e), 'Unauthorized')
    }
    await program.methods.proposeSplit(new BN(0))
      .accountsPartial({ landlord: landlord.publicKey, lease }).signers([landlord]).rpc()
    try {
      await program.methods.approve()
        .accountsPartial(settleAccounts(landlord, lease, vault)).signers([landlord]).rpc()
      assert.fail('landlord approved their own proposal')
    } catch (e: any) {
      assert.include(String(e), 'Unauthorized')
    }
  })

  it('lets the mediator decide a dispute', async () => {
    const { lease, vault } = await lock(500 * USDC, now() + 3600)
    await program.methods.proposeSplit(new BN(0))
      .accountsPartial({ landlord: landlord.publicKey, lease }).signers([landlord]).rpc()
    await program.methods.dispute()
      .accountsPartial({ signer: tenant.publicKey, lease }).signers([tenant]).rpc()

    try {
      await program.methods.resolve(new BN(500 * USDC))
        .accountsPartial(settleAccounts(tenant, lease, vault)).signers([tenant]).rpc()
      assert.fail('tenant resolved their own dispute')
    } catch (e: any) {
      assert.include(String(e), 'Unauthorized')
    }

    const before = await balance(tenantAta)
    await program.methods.resolve(new BN(400 * USDC))
      .accountsPartial(settleAccounts(mediator, lease, vault)).signers([mediator]).rpc()
    assert.equal((await balance(tenantAta)) - before, 400 * USDC)
    assert.deepEqual((await program.account.lease.fetch(lease)).outcome, { mediated: {} })
  })

  it('refunds the tenant in full when the landlord stays silent', async () => {
    const { lease, vault } = await lock(300 * USDC, now() + 2)
    try {
      await program.methods.claimAfterTimeout()
        .accountsPartial(settleAccounts(tenant, lease, vault)).signers([tenant]).rpc()
      assert.fail('claimed before the deadline')
    } catch (e: any) {
      assert.include(String(e), 'TooEarly')
    }
    await sleep(4000)
    try {
      await program.methods.proposeSplit(new BN(0))
        .accountsPartial({ landlord: landlord.publicKey, lease }).signers([landlord]).rpc()
      assert.fail('landlord proposed after the deadline')
    } catch (e: any) {
      assert.include(String(e), 'DeadlinePassed')
    }
    const before = await balance(tenantAta)
    await program.methods.claimAfterTimeout()
      .accountsPartial(settleAccounts(tenant, lease, vault)).signers([tenant]).rpc()
    assert.equal((await balance(tenantAta)) - before, 300 * USDC)
  })

  it('keeps the tenant record', async () => {
    const r = await program.account.tenantRecord.fetch(recordPda)
    assert.equal(r.deposits, 4)
    assert.equal(r.settled, 3)
    assert.equal(r.fullRefunds, 1)
    assert.equal(r.disputes, 1)
    assert.equal(r.totalDeposited.toNumber(), 2100 * USDC)
    assert.equal(r.totalReturned.toNumber(), 1700 * USDC)
  })
})

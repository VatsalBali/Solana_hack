// Locks the deposits the demo video needs, using the wallets in app/.env.local:
//   - 500 USDC, landlord deadline 60 min  (dispute scene)
//   - 800 USDC, landlord deadline 30 s    (timeout scene)
//
//   node scripts/prepare-scenes.mjs   (run from app/)
import anchor from '@anchor-lang/core'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { AnchorProvider, BN, Program } = anchor

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, process.env.ENV_FILE || '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const kp = (key) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env[key])))
const tenant = kp('VITE_TENANT_SECRET')
const landlord = kp('VITE_LANDLORD_SECRET').publicKey
const mediator = kp('VITE_MEDIATOR_SECRET').publicKey
const mint = new PublicKey(env.VITE_MINT)
const idl = JSON.parse(readFileSync(join(root, 'src', 'idl', 'fair_deposit.json'), 'utf8'))

const connection = new Connection(env.VITE_RPC_URL, 'confirmed')
const wallet = {
  publicKey: tenant.publicKey,
  signTransaction: async (tx) => (tx.partialSign(tenant), tx),
  signAllTransactions: async (txs) => txs.map((tx) => (tx.partialSign(tenant), tx)),
}
const program = new Program(idl, new AnchorProvider(connection, wallet, { commitment: 'confirmed' }))
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function lock(usdc, seconds) {
  const leaseId = new BN(Date.now())
  const lease = pda([Buffer.from('lease'), tenant.publicKey.toBuffer(), leaseId.toArrayLike(Buffer, 'le', 8)])
  for (let attempt = 1; ; attempt++) {
    try {
      const sig = await program.methods
        .createDeposit(leaseId, new BN(usdc * 1_000_000), new BN(Math.floor(Date.now() / 1000) + seconds))
        .accountsPartial({
          tenant: tenant.publicKey,
          landlord,
          mediator,
          mint,
          lease,
          vault: pda([Buffer.from('vault'), lease.toBuffer()]),
          tenantToken: getAssociatedTokenAddressSync(mint, tenant.publicKey),
          record: pda([Buffer.from('record'), tenant.publicKey.toBuffer()]),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
      console.log(`Locked ${usdc} USDC (deadline ${seconds}s): ${sig}`)
      return
    } catch (e) {
      if (attempt >= 4) throw e
      console.log(`Retrying ${usdc} USDC after: ${String(e.message ?? e).split('\n')[0]}`)
      await sleep(5000 * attempt)
    }
  }
}

await lock(500, 60 * 60)
await lock(800, 30)
console.log('Scenes ready. Reload the app.')

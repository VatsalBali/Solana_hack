import { useCallback, useEffect, useState } from 'react'
import type { Keypair } from '@solana/web3.js'
import {
  approve,
  balances,
  claimAfterTimeout,
  createDeposit,
  dispute,
  errorText,
  explorerAddr,
  explorerTx,
  fetchLeases,
  fetchRecord,
  fmtUsdc,
  fromUnits,
  isConfigured,
  outcomeOf,
  proposeSplit,
  resolve,
  short,
  statusOf,
  wallets,
  type LeaseWithKey,
  type Role,
  type TenantRecord,
} from './fairDeposit'

const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: 'tenant', label: 'Tenant', blurb: 'Locks the deposit, approves or disputes the split' },
  { id: 'landlord', label: 'Landlord', blurb: 'Proposes how much goes back after move-out' },
  { id: 'mediator', label: 'Mediator', blurb: 'Decides the split only if there is a dispute' },
]

const STATUS_LABEL = {
  active: 'Locked in escrow',
  proposed: 'Split proposed',
  disputed: 'In dispute',
  settled: 'Settled',
} as const

const OUTCOME_LABEL = {
  none: '',
  agreed: 'Agreed by both sides',
  mediated: 'Decided by mediator',
  timedOut: 'Refunded after landlord timeout',
} as const

type LogEntry = { text: string; sig?: string; error?: boolean }

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function countdown(seconds: number) {
  if (seconds <= 0) return 'passed'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export default function App() {
  const [role, setRole] = useState<Role>('tenant')
  const [leases, setLeases] = useState<LeaseWithKey[]>([])
  const [record, setRecord] = useState<TenantRecord | null>(null)
  const [bal, setBal] = useState<Record<Role, { sol: number; usdc: number }>>()
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const now = useNow()

  const me = wallets[role]

  const refresh = useCallback(async () => {
    if (!isConfigured) return
    try {
      const [ls, rec, t, l, m] = await Promise.all([
        fetchLeases(),
        fetchRecord(wallets.tenant!.publicKey),
        balances(wallets.tenant!.publicKey),
        balances(wallets.landlord!.publicKey),
        balances(wallets.mediator!.publicKey),
      ])
      setLeases(ls)
      setRecord(rec)
      setBal({ tenant: t, landlord: l, mediator: m })
    } catch (e) {
      setLog((x) => [{ text: `Could not load data: ${errorText(e)}`, error: true }, ...x])
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 8000)
    return () => clearInterval(id)
  }, [refresh])

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label)
    try {
      const sig = await fn()
      setLog((x) => [{ text: label, sig }, ...x])
      await refresh()
    } catch (e) {
      setLog((x) => [{ text: `${label} failed: ${errorText(e)}`, error: true }, ...x])
    } finally {
      setBusy(null)
    }
  }

  if (!isConfigured) {
    return (
      <main className="setup">
        <h1>Tessera</h1>
        <p>
          Demo wallets are not set up yet. Run <code>node scripts/setup-demo.mjs</code> inside <code>app/</code>,
          then restart <code>npm run dev</code>.
        </p>
      </main>
    )
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo">T</span>
          <div>
            <h1>Tessera</h1>
            <p>Rental deposits in a neutral Solana escrow</p>
          </div>
        </div>
        <span className="net">Solana devnet · test USDC</span>
      </header>

      <nav className="roles" aria-label="Act as">
        {ROLES.map((r) => (
          <div key={r.id} className={r.id === role ? 'role on' : 'role'}>
            <button className="role-pick" onClick={() => setRole(r.id)} aria-pressed={r.id === role}>
              <strong>Act as {r.label}</strong>
              <span>{r.blurb}</span>
            </button>
            <small>
              <a href={explorerAddr(wallets[r.id]!.publicKey)} target="_blank" rel="noreferrer">
                {short(wallets[r.id]!.publicKey)}
              </a>
              {bal && ` · ${bal[r.id].usdc.toLocaleString('en-US')} USDC · ${bal[r.id].sol.toFixed(2)} SOL`}
            </small>
          </div>
        ))}
      </nav>

      <div className="grid">
        <section className="side">
          {role === 'tenant' && <NewDeposit busy={busy} onSubmit={(usdc, secs) =>
            run(`Locked ${usdc} USDC deposit`, () =>
              createDeposit(wallets.tenant!, wallets.landlord!.publicKey, wallets.mediator!.publicKey, usdc,
                Math.floor(Date.now() / 1000) + secs))} />}
          <RecordCard record={record} />
          <Activity log={log} />
        </section>

        <section className="main">
          <h2>Deposits</h2>
          {leases.length === 0 && <p className="empty">No deposits yet. Switch to Tenant and lock one.</p>}
          {leases.map((l) => (
            <LeaseCard key={l.publicKey.toBase58()} lease={l} role={role} me={me!} now={now} busy={busy} run={run} />
          ))}
        </section>
      </div>
    </div>
  )
}

function NewDeposit({ busy, onSubmit }: { busy: string | null; onSubmit: (usdc: number, secs: number) => void }) {
  const [amount, setAmount] = useState(1200)
  const [minutes, setMinutes] = useState(2)
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(amount, Math.round(minutes * 60))
      }}
    >
      <h2>Lock a deposit</h2>
      <label>
        Deposit (USDC)
        <input type="number" min={1} step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      <label>
        Landlord must answer within (minutes)
        <input type="number" min={0.5} step="any" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </label>
      <p className="hint">Short for the demo. In real use this would be days after move-out.</p>
      <button className="primary" disabled={!!busy || amount <= 0}>
        {busy?.startsWith('Locked') ? 'Locking…' : 'Lock deposit in escrow'}
      </button>
    </form>
  )
}

function RecordCard({ record }: { record: TenantRecord | null }) {
  return (
    <div className="card">
      <h2>Tenant record</h2>
      <p className="hint">On-chain history the tenant can show the next landlord. Nobody can edit it.</p>
      {record ? (
        <dl className="stats">
          <div><dt>Deposits</dt><dd>{record.deposits}</dd></div>
          <div><dt>Settled</dt><dd>{record.settled}</dd></div>
          <div><dt>Full refunds</dt><dd>{record.fullRefunds}</dd></div>
          <div><dt>Disputes</dt><dd>{record.disputes}</dd></div>
          <div className="wide">
            <dt>Returned / deposited</dt>
            <dd>{fmtUsdc(record.totalReturned)} / {fmtUsdc(record.totalDeposited)} USDC</dd>
          </div>
        </dl>
      ) : (
        <p className="empty">No history yet.</p>
      )}
    </div>
  )
}

function Activity({ log }: { log: LogEntry[] }) {
  if (log.length === 0) return null
  return (
    <div className="card">
      <h2>Activity</h2>
      <ul className="log">
        {log.slice(0, 8).map((e, i) => (
          <li key={i} className={e.error ? 'err' : ''}>
            {e.text}
            {e.sig && (
              <>
                {' · '}
                <a href={explorerTx(e.sig)} target="_blank" rel="noreferrer">view on explorer</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

type RunFn = (label: string, fn: () => Promise<string>) => Promise<void>

function LeaseCard({ lease, role, me, now, busy, run }: {
  lease: LeaseWithKey; role: Role; me: Keypair; now: number; busy: string | null; run: RunFn
}) {
  const a = lease.account
  const status = statusOf(a)
  const total = fromUnits(a.amount)
  const left = a.refundAfter.toNumber() - now
  const [split, setSplit] = useState(total)
  const disabled = !!busy

  const mine =
    (role === 'tenant' && a.tenant.equals(me.publicKey)) ||
    (role === 'landlord' && a.landlord.equals(me.publicKey)) ||
    (role === 'mediator' && a.mediator.equals(me.publicKey))

  return (
    <article className={`lease ${status}`}>
      <div className="lease-head">
        <div>
          <span className="amount">{fmtUsdc(a.amount)} USDC</span>
          <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
        </div>
        <a href={explorerAddr(lease.publicKey)} target="_blank" rel="noreferrer" className="mono">
          {short(lease.publicKey)}
        </a>
      </div>

      {status === 'active' && (
        <p className={left > 0 ? '' : 'warn'}>
          {left > 0
            ? `Landlord has ${countdown(left)} to propose a split. If they stay silent, the tenant gets it all back.`
            : 'The landlord missed the deadline. The tenant can take the full deposit back.'}
        </p>
      )}
      {status === 'proposed' && (
        <p>
          Landlord proposes <b>{fmtUsdc(a.proposedTenantAmount)} USDC</b> back to the tenant and keeps{' '}
          <b>{fmtUsdc(a.amount.sub(a.proposedTenantAmount))} USDC</b>.
        </p>
      )}
      {status === 'disputed' && <p>Waiting for the mediator to decide the split.</p>}
      {status === 'settled' && (
        <p>
          {OUTCOME_LABEL[outcomeOf(a)]}: tenant received <b>{fmtUsdc(a.tenantReceived)} USDC</b>, landlord received{' '}
          <b>{fmtUsdc(a.amount.sub(a.tenantReceived))} USDC</b>.
        </p>
      )}

      {mine && status !== 'settled' && (
        <div className="actions">
          {role === 'landlord' && (status === 'active' || status === 'proposed') && left > 0 && (
            <>
              <label className="inline">
                Return to tenant
                <input type="number" min={0} max={total} step="any" value={split}
                  onChange={(e) => setSplit(Number(e.target.value))} />
                USDC
              </label>
              <button className="primary" disabled={disabled || split < 0 || split > total}
                onClick={() => run(`Proposed ${split} USDC back to tenant`, () => proposeSplit(me, lease.publicKey, split))}>
                Propose split
              </button>
            </>
          )}
          {role === 'tenant' && status === 'proposed' && (
            <button className="primary" disabled={disabled}
              onClick={() => run('Tenant approved the split', () => approve(me, lease))}>
              Approve and release
            </button>
          )}
          {role === 'tenant' && status === 'active' && left <= 0 && (
            <button className="primary" disabled={disabled}
              onClick={() => run('Tenant claimed full refund after timeout', () => claimAfterTimeout(me, lease))}>
              Claim full refund
            </button>
          )}
          {(role === 'tenant' || role === 'landlord') && (status === 'active' || status === 'proposed') && (
            <button disabled={disabled}
              onClick={() => run(`${role === 'tenant' ? 'Tenant' : 'Landlord'} opened a dispute`, () => dispute(me, lease.publicKey))}>
              Dispute
            </button>
          )}
          {role === 'mediator' && status === 'disputed' && (
            <>
              <label className="inline">
                Tenant gets
                <input type="number" min={0} max={total} step="any" value={split}
                  onChange={(e) => setSplit(Number(e.target.value))} />
                USDC
              </label>
              <button className="primary" disabled={disabled || split < 0 || split > total}
                onClick={() => run(`Mediator awarded ${split} USDC to tenant`, () => resolve(me, lease, split))}>
                Resolve dispute
              </button>
            </>
          )}
        </div>
      )}
      {!mine && status !== 'settled' && (
        <p className="hint">
          {status === 'disputed' ? 'Switch to Mediator to resolve.' : `Viewing as ${role}. No action for you here.`}
        </p>
      )}
    </article>
  )
}

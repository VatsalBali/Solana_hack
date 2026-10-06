import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Keypair } from '@solana/web3.js'
import {
  approve,
  usdcBalances,
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
  statusOf,
  wallets,
  type LeaseWithKey,
  type Role,
  type TenantRecord,
} from './fairDeposit'

const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: 'tenant', label: 'Tenant', hint: 'You pay the deposit and get it back.' },
  { id: 'landlord', label: 'Landlord', hint: 'You say how much goes back after move-out.' },
  { id: 'mediator', label: 'Mediator', hint: 'You decide only when the two sides disagree.' },
]

const OUTCOME = {
  none: '',
  agreed: 'Agreed by both sides',
  mediated: 'Decided by the mediator',
  timedOut: 'Landlord missed the deadline, full refund',
} as const

type Notice = { text: string; sig?: string; error?: boolean }
type RunFn = (label: string, fn: () => Promise<string>) => Promise<void>

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function countdown(seconds: number) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const [role, setRole] = useState<Role>('tenant')
  const [leases, setLeases] = useState<LeaseWithKey[]>([])
  const [record, setRecord] = useState<TenantRecord | null>(null)
  const [usdc, setUsdc] = useState<Record<Role, number>>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const now = useNow()

  const refresh = useCallback(async () => {
    if (!isConfigured) return
    try {
      const [ls, rec, [t, l, m]] = await Promise.all([
        fetchLeases(),
        fetchRecord(wallets.tenant!.publicKey),
        usdcBalances([wallets.tenant!.publicKey, wallets.landlord!.publicKey, wallets.mediator!.publicKey]),
      ])
      setLeases(ls)
      setRecord(rec)
      setUsdc({ tenant: t, landlord: l, mediator: m })
    } catch (e) {
      setNotice({ text: `Could not load data: ${errorText(e)}`, error: true })
    }
  }, [])

  useEffect(() => {
    refresh()
    // Poll gently and only while the tab is visible: the public devnet RPC rate-limits.
    const id = setInterval(() => { if (!document.hidden) refresh() }, 15000)
    return () => clearInterval(id)
  }, [refresh])

  const run: RunFn = async (label, fn) => {
    setBusy(true)
    setNotice({ text: 'Confirming on Solana…' })
    try {
      const sig = await fn()
      setNotice({ text: label, sig })
      await refresh()
    } catch (e) {
      setNotice({ text: `That didn't work: ${errorText(e)}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  if (!isConfigured) {
    return (
      <main className="page">
        <h1 className="wordmark">Tessera</h1>
        <p className="muted">
          Demo wallets are not set up yet. Run <code>npm run setup</code> inside <code>app/</code>, then restart{' '}
          <code>npm run dev</code>.
        </p>
      </main>
    )
  }

  const current = ROLES.find((r) => r.id === role)!

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1 className="wordmark">Tessera</h1>
          <p className="muted">Your rental deposit, held fairly.</p>
        </div>
        <span className="tag">Test network</span>
      </header>

      <section className="who">
        <p className="label">I am the</p>
        <div className="switch" role="tablist">
          {ROLES.map((r) => (
            <button key={r.id} role="tab" aria-selected={r.id === role} className={r.id === role ? 'on' : ''}
              onClick={() => setRole(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {current.hint}
          {usdc && <> Balance: <b>{usdc[role].toLocaleString('en-US')} USDC</b>.</>}
        </p>
      </section>

      {notice && (
        <div className={`notice ${notice.error ? 'error' : ''}`} role="status">
          <span>{notice.text}</span>
          {notice.sig && <a href={explorerTx(notice.sig)} target="_blank" rel="noreferrer">View receipt</a>}
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {role === 'tenant' && (
        <NewDeposit busy={busy} onSubmit={(amount, secs) =>
          run(`Deposit of ${amount.toLocaleString('en-US')} USDC is locked`, () =>
            createDeposit(wallets.tenant!, wallets.landlord!.publicKey, wallets.mediator!.publicKey, amount,
              Math.floor(Date.now() / 1000) + secs))} />
      )}

      <section>
        <h2>Deposits</h2>
        {leases.length === 0 && <p className="muted">No deposits yet. As the tenant, lock one above.</p>}
        <div className="list">
          {leases.map((l) => (
            <LeaseCard key={l.publicKey.toBase58()} lease={l} role={role} me={wallets[role]!} now={now} busy={busy} run={run} />
          ))}
        </div>
      </section>

      {role !== 'mediator' && <RecordCard record={record} landlordView={role === 'landlord'} />}
    </main>
  )
}

function NewDeposit({ busy, onSubmit }: { busy: boolean; onSubmit: (amount: number, secs: number) => void }) {
  const [amount, setAmount] = useState(1200)
  const [minutes, setMinutes] = useState(5)
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSubmit(amount, Math.round(minutes * 60)) }}>
      <h2>Pay a deposit</h2>
      <div className="row">
        <label>
          Amount
          <span className="field"><input type="number" min={1} step="any" value={amount}
            onChange={(e) => setAmount(Number(e.target.value))} /> USDC</span>
        </label>
        <label>
          Landlord must reply within
          <span className="field"><input type="number" min={0.5} step="any" value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))} /> min</span>
        </label>
      </div>
      <p className="muted small">The money goes into escrow, not to the landlord. A short deadline is for the demo; in real life it would be days.</p>
      <button className="primary" disabled={busy || amount <= 0}>Lock deposit</button>
    </form>
  )
}

function RecordCard({ record, landlordView }: { record: TenantRecord | null; landlordView: boolean }) {
  return (
    <section className="card">
      <h2>{landlordView ? "Tenant's rental record" : 'Your rental record'}</h2>
      <p className="muted small">
        {landlordView ? 'How this tenant behaved in past rentals.' : 'Show this to your next landlord.'} Stored on Solana, so nobody can edit it.
      </p>
      {record ? (
        <div className="stats">
          <div><b>{record.deposits}</b><span>deposits</span></div>
          <div><b>{record.fullRefunds}</b><span>full refunds</span></div>
          <div><b>{record.disputes}</b><span>disputes</span></div>
          <div><b>{fmtUsdc(record.totalReturned)}</b><span>of {fmtUsdc(record.totalDeposited)} USDC returned</span></div>
        </div>
      ) : (
        <p className="muted">No history yet.</p>
      )}
    </section>
  )
}

function Steps({ step, middle }: { step: number; middle: string }) {
  const labels = ['Locked', middle, 'Paid out']
  return (
    <ol className="steps">
      {labels.map((l, i) => (
        <li key={l} className={i < step ? 'done' : i === step ? 'now' : ''}>{l}</li>
      ))}
    </ol>
  )
}

function LeaseCard({ lease, role, me, now, busy, run }: {
  lease: LeaseWithKey; role: Role; me: Keypair; now: number; busy: boolean; run: RunFn
}) {
  const a = lease.account
  const status = statusOf(a)
  const total = fromUnits(a.amount)
  const left = a.refundAfter.toNumber() - now
  const [split, setSplit] = useState(total)
  const valid = split >= 0 && split <= total

  const step = status === 'settled' ? 3 : 1
  const middle = status === 'disputed' ? 'With mediator' : status === 'proposed' ? 'Split proposed' : 'Decision'

  let message: ReactNode
  if (status === 'active') {
    message = left > 0
      ? <>Waiting for the landlord. <span className="clock">{countdown(left)}</span> left before the tenant can take it all back.</>
      : <span className="warn">The landlord missed the deadline. The tenant can take the full deposit back.</span>
  } else if (status === 'proposed') {
    message = <>Landlord offers <b>{fmtUsdc(a.proposedTenantAmount)}</b> back and keeps <b>{fmtUsdc(a.amount.sub(a.proposedTenantAmount))}</b>.</>
  } else if (status === 'disputed') {
    message = <span className="warn">The two sides disagree. The mediator will decide.</span>
  } else {
    message = <>{OUTCOME[outcomeOf(a)]}. Tenant got <b>{fmtUsdc(a.tenantReceived)}</b>, landlord got <b>{fmtUsdc(a.amount.sub(a.tenantReceived))}</b>.</>
  }

  let action: ReactNode = null
  if (status !== 'settled') {
    if (role === 'tenant' && a.tenant.equals(me.publicKey)) {
      action = (
        <>
          {status === 'proposed' && (
            <button className="primary" disabled={busy} onClick={() => run('You accepted. The money is paid out', () => approve(me, lease))}>
              Accept and pay out
            </button>
          )}
          {status === 'active' && left <= 0 && (
            <button className="primary" disabled={busy} onClick={() => run('Full deposit returned to you', () => claimAfterTimeout(me, lease))}>
              Take my deposit back
            </button>
          )}
          {(status === 'proposed' || (status === 'active' && left > 0)) && (
            <button disabled={busy} onClick={() => run('Sent to the mediator', () => dispute(me, lease.publicKey))}>
              Disagree
            </button>
          )}
        </>
      )
    } else if (role === 'landlord' && a.landlord.equals(me.publicKey) && status !== 'disputed') {
      action = left > 0 ? (
        <>
          <label className="field">Give back <input type="number" min={0} max={total} step="any" value={split}
            onChange={(e) => setSplit(Number(e.target.value))} /> of {fmtUsdc(a.amount)}</label>
          <button className="primary" disabled={busy || !valid}
            onClick={() => run(`You offered ${split.toLocaleString('en-US')} USDC back`, () => proposeSplit(me, lease.publicKey, split))}>
            {status === 'proposed' ? 'Change offer' : 'Send offer'}
          </button>
          <button disabled={busy} onClick={() => run('Sent to the mediator', () => dispute(me, lease.publicKey))}>Ask mediator</button>
        </>
      ) : <span className="muted small">Your deadline has passed.</span>
    } else if (role === 'mediator' && a.mediator.equals(me.publicKey) && status === 'disputed') {
      action = (
        <>
          <label className="field">Tenant gets <input type="number" min={0} max={total} step="any" value={split}
            onChange={(e) => setSplit(Number(e.target.value))} /> of {fmtUsdc(a.amount)}</label>
          <button className="primary" disabled={busy || !valid}
            onClick={() => run(`Decided: ${split.toLocaleString('en-US')} USDC to the tenant`, () => resolve(me, lease, split))}>
            Decide
          </button>
        </>
      )
    }
  }

  return (
    <article className={`card lease ${status}`}>
      <div className="lease-top">
        <span className="amount">{fmtUsdc(a.amount)} <small>USDC</small></span>
        <a className="muted small" href={explorerAddr(lease.publicKey)} target="_blank" rel="noreferrer">On-chain record</a>
      </div>
      <Steps step={step} middle={middle} />
      <p className="message">{message}</p>
      {action && <div className="actions">{action}</div>}
    </article>
  )
}

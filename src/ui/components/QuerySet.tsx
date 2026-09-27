import { useState } from 'react'
import type { QueryOutcome, RunSummary } from '../../lib/evaluate.js'
import { DEFAULT_QUERY_SET } from '../querySet.js'

interface EvaluateResponse {
  goggle: string
  outcomes: QueryOutcome[]
  summary: RunSummary
  meta: {
    callsMade: number
    baselinesCached: number
    elapsedMs: number
    budgetRemaining: number | null
  }
}

const VERDICT_LABEL: Record<QueryOutcome['verdict'], string> = {
  overshoot: 'overshoot',
  narrowed: 'narrowed',
  clean: 'clean',
}

export function QuerySet({ goggle }: { goggle: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(DEFAULT_QUERY_SET.join('\n'))
  const [data, setData] = useState<EvaluateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const queries = text
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goggle, queries }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error([json.error, json.hint].filter(Boolean).join(' — '))
      setData(json as EvaluateResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="queryset">
      <button className="disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        Test this Goggle across a query set
        <small>
          one query tells you what happened; a set tells you whether the rule is the problem
        </small>
      </button>

      {open && (
        <>
          <div className="row">
            <label className="grow">
              <span>Queries — one per line, up to 10</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                rows={6}
              />
            </label>
            <button className="run" onClick={run} disabled={loading || !goggle.trim() || queries.length === 0}>
              {loading ? 'Running…' : `Run ${Math.min(queries.length, 10)} queries`}
            </button>
          </div>
          {!goggle.trim() && <p className="flagnote">Write a Goggle above first.</p>}

          {error && <div className="error">{error}</div>}

          {data && (
            <>
              <div className={`verdict-banner ${data.summary.generalizes ? 'bad' : 'ok'}`}>
                {data.summary.generalizes ? (
                  <>
                    <strong>
                      {data.summary.overshoot} of {data.summary.total} queries overshot.
                    </strong>{' '}
                    This is the rule, not the query. The Goggle pulled in{' '}
                    {data.summary.totalPulledIn} results that were absent from their baselines
                    entirely, and cost a median of {Math.abs(data.summary.medianHostDelta ?? 0)}{' '}
                    hosts per query.
                  </>
                ) : (
                  <>
                    <strong>
                      {data.summary.overshoot} of {data.summary.total} queries overshot.
                    </strong>{' '}
                    {data.summary.clean} clean, {data.summary.narrowed} narrowed. Median host
                    change {data.summary.medianHostDelta ?? 0}. This Goggle removes what it names
                    without reaching for anything else.
                  </>
                )}
              </div>

              <table className="bake">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Hosts</th>
                    <th>Pulled in</th>
                    <th>Dropped</th>
                    <th>Changed</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.map((o) => (
                    <tr key={o.query}>
                      <td className="cfg">{o.query}</td>
                      <td className={o.metrics.goggledHosts < o.metrics.baselineHosts ? 'warn' : ''}>
                        {o.metrics.baselineHosts} → {o.metrics.goggledHosts}
                      </td>
                      <td className={o.metrics.pulledInCount > 0 ? 'warn' : ''}>
                        {o.metrics.pulledInCount || '—'}
                      </td>
                      <td>{o.metrics.droppedCount || '—'}</td>
                      <td>{Math.round(o.metrics.changedPct * 100)}%</td>
                      <td>
                        <span className={`verdict ${o.verdict}`}>{VERDICT_LABEL[o.verdict]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="flagnote">
                {data.meta.callsMade} API calls · {data.meta.baselinesCached} baselines served
                from cache · {data.meta.elapsedMs}ms
                {data.meta.budgetRemaining !== null &&
                  ` · ${data.meta.budgetRemaining} left in today's budget`}
                . Re-running the same set against a different Goggle costs half, because the
                baselines are already cached.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}

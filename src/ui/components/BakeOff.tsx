import { useState } from 'react'
import type { GroundingSummary, BaselineComparison } from '../../lib/grounding.js'
import { GROUND_CONFIGS, FRESHNESS_EXAMPLE } from '../groundPresets.js'

interface ConfigResult {
  name: string
  goggle: string
  elapsedMs: number
  summary: GroundingSummary
  sources: { url: string; hostname: string | null }[]
  vsBaseline: BaselineComparison | null
}

interface GroundResponse {
  query: string
  configs: ConfigResult[]
  meta: { callsMade: number; elapsedMs: number; budgetRemaining: number | null }
}

const days = (n: number | null) => (n === null ? '—' : `${Math.round(n)}d`)

interface Props {
  query: string
  setQuery: (q: string) => void
}

export function BakeOff({ query, setQuery }: Props) {
  const [configs, setConfigs] = useState(GROUND_CONFIGS)
  const [data, setData] = useState<GroundResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, configs }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error([json.error, json.hint].filter(Boolean).join(' — '))
      setData(json as GroundResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  /** Loads the question where the freshness gap is largest, Goggles and all. */
  function loadFreshnessExample() {
    setQuery(FRESHNESS_EXAMPLE.query)
    setConfigs(FRESHNESS_EXAMPLE.configs)
    setData(null)
  }

  function editGoggle(i: number, goggle: string) {
    setConfigs((prev) => prev.map((c, j) => (j === i ? { ...c, goggle } : c)))
  }

  const base = data?.configs[0]
  // The freshest-looking goggle is often the stalest. Worth calling out when true.
  const stalest = data?.configs.reduce((worst, c) =>
    (c.summary.medianAgeDays ?? -1) > (worst.summary.medianAgeDays ?? -1) ? c : worst,
  )
  const staleCallout =
    base && stalest && stalest !== base && (stalest.summary.medianAgeDays ?? 0) >
      (base.summary.medianAgeDays ?? 0) * 2

  return (
    <div className="bakeoff">
      <p className="lede">
        The same question, grounded through <code>llm/context</code> under different Goggles.
        A Goggle here does not change <em>how much</em> an LLM is grounded on — it changes
        <em> which pages</em> that grounding comes from.{' '}
        <button className="linky" onClick={loadFreshnessExample}>
          Try the question where a docs Goggle grounds on sources 4× staler →
        </button>
      </p>

      <section className="controls">
        <div className="row">
          <label className="grow">
            <span>Question</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && run()}
            />
          </label>
          <button className="run" onClick={run} disabled={loading || !query.trim()}>
            {loading ? 'Running…' : `Run bake-off (${configs.length} calls)`}
          </button>
        </div>
        <div className="configs">
          {configs.map((c, i) => (
            <label key={c.name} className="config">
              <span>{c.name}{i === 0 && <em> — baseline</em>}</span>
              <textarea
                value={c.goggle}
                onChange={(e) => editGoggle(i, e.target.value)}
                placeholder={i === 0 ? 'no goggle — this is the comparison point' : ''}
                spellCheck={false}
                rows={5}
                disabled={i === 0}
              />
            </label>
          ))}
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <table className="bake">
            <thead>
              <tr>
                <th>Config</th>
                <th>Sources</th>
                <th>Hosts</th>
                <th>Snippets</th>
                <th>~Tokens</th>
                <th>Per source</th>
                <th>Median age</th>
                <th>Shared with baseline</th>
              </tr>
            </thead>
            <tbody>
              {data.configs.map((c, i) => {
                const v = c.vsBaseline
                return (
                  <tr key={c.name} className={i === 0 ? 'baseline-row' : ''}>
                    <td className="cfg">{c.name}</td>
                    <td>{c.summary.sourceCount}</td>
                    <td className={base && c.summary.hostCount < base.summary.hostCount / 2 ? 'warn' : ''}>
                      {c.summary.hostCount}
                    </td>
                    <td>{c.summary.snippetCount}</td>
                    <td>{c.summary.estimatedTokens.toLocaleString()}</td>
                    <td>{c.summary.snippetsPerSource.toFixed(1)}</td>
                    <td className={
                      base && (c.summary.medianAgeDays ?? 0) > (base.summary.medianAgeDays ?? 0) * 2
                        ? 'warn'
                        : ''
                    }>
                      {days(c.summary.medianAgeDays)}
                    </td>
                    <td>
                      {v ? (
                        <span className={v.totalReplacement ? 'gone' : ''}>
                          {v.sharedCount}/{v.sharedCount + v.uniqueCount}
                          {v.totalReplacement && ' — replaced outright'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {staleCallout && stalest && base && (
            <p className="overshoot">
              <strong>Authority is not freshness.</strong> <code>{stalest.name}</code> grounds on
              sources with a median age of {days(stalest.summary.medianAgeDays)} against the
              baseline's {days(base.summary.medianAgeDays)} — for roughly the same token volume.
              The more authoritative-looking sources are the older ones.
            </p>
          )}

          <p className="flagnote">
            {data.meta.callsMade} API calls · {data.meta.elapsedMs}ms
            {data.meta.budgetRemaining !== null &&
              ` · ${data.meta.budgetRemaining} left in today's budget`}
            . Token counts are estimated from snippet length; they compare configs, they do not bill.
          </p>

          <div className="source-lists">
            {data.configs.map((c) => (
              <div key={c.name} className="column">
                <h2>
                  {c.name} <small>{c.summary.hostCount} hosts</small>
                </h2>
                <ol>
                  {c.sources.slice(0, 10).map((s) => (
                    <li key={s.url}>
                      <div className="body">
                        <a href={s.url} target="_blank" rel="noreferrer" className="title">
                          {s.hostname ?? s.url}
                        </a>
                        <span className="url">{s.url}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}

      {!data && !error && (
        <p className="empty">
          Edit the Goggles above, then hit <strong>Run bake-off</strong>.
        </p>
      )}
    </div>
  )
}

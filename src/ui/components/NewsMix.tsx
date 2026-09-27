import { useState } from 'react'
import type { NewsSummary, OutletComparison } from '../../lib/news.js'
import { NEWS_CONFIGS, FRESHNESS_WINDOWS } from '../newsPresets.js'

interface ConfigResult {
  name: string
  goggle: string
  freshness: string
  elapsedMs: number
  summary: NewsSummary
  results: { url: string; title: string | null; age: string | null; outlet: string | null }[]
  vsBaseline: OutletComparison | null
}

interface NewsResponse {
  query: string
  configs: ConfigResult[]
  meta: { callsMade: number; elapsedMs: number; budgetRemaining: number | null }
}

interface Props {
  query: string
  setQuery: (q: string) => void
}

const days = (n: number | null) => (n === null ? '—' : n >= 365 ? `${(n / 365).toFixed(1)}y` : `${Math.round(n)}d`)

export function NewsMix({ query, setQuery }: Props) {
  const [configs, setConfigs] = useState(NEWS_CONFIGS)
  const [data, setData] = useState<NewsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, configs }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error([json.error, json.hint].filter(Boolean).join(' — '))
      setData(json as NewsResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const edit = (i: number, patch: Partial<(typeof NEWS_CONFIGS)[number]>) =>
    setConfigs((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const base = data?.configs[0]
  // A "news" result measured in years is the point of this tab.
  const stale = base && (base.summary.oldestAgeDays ?? 0) > 365 * 2

  return (
    <div className="newsmix">
      <p className="lede">
        The same question against <code>news/search</code>, under a freshness window and a
        Goggle. Two independent levers — and the first row applies neither, which is where
        it gets interesting.
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
            {loading ? 'Running…' : `Run (${configs.length} calls)`}
          </button>
        </div>
        <div className="configs">
          {configs.map((c, i) => (
            <div key={c.name} className="config">
              <span>
                {c.name}
                {i === 0 && <em> — baseline</em>}
              </span>
              <select
                value={c.freshness ?? ''}
                onChange={(e) => edit(i, { freshness: e.target.value })}
              >
                {FRESHNESS_WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
              <textarea
                value={c.goggle ?? ''}
                onChange={(e) => edit(i, { goggle: e.target.value })}
                placeholder="no goggle"
                spellCheck={false}
                rows={4}
              />
            </div>
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
                <th>Results</th>
                <th>Outlets</th>
                <th>Top outlet</th>
                <th>Median age</th>
                <th>Oldest</th>
                <th>Undated</th>
                <th>Outlets changed</th>
              </tr>
            </thead>
            <tbody>
              {data.configs.map((c, i) => {
                const v = c.vsBaseline
                const old = c.summary.oldestAgeDays
                return (
                  <tr key={c.name} className={i === 0 ? 'baseline-row' : ''}>
                    <td className="cfg">{c.name}</td>
                    <td>{c.summary.resultCount}</td>
                    <td>{c.summary.outletCount}</td>
                    <td>{c.summary.topOutletShare ? `${Math.round(c.summary.topOutletShare * 100)}%` : '—'}</td>
                    <td>{days(c.summary.medianAgeDays)}</td>
                    <td className={old !== null && old > 365 * 2 ? 'warn' : ''}>{days(old)}</td>
                    <td>{c.summary.undatedCount || '—'}</td>
                    <td>{v ? `+${v.added.length} / −${v.lost.length}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {stale && base && (
            <p className="overshoot">
              <strong>“News” does not mean recent.</strong> With no freshness window,{' '}
              <code>news/search</code> returned a result{' '}
              <strong>{days(base.summary.oldestAgeDays)}</strong> old for this query — the
              endpoint serves evergreen pages dated by publication, not a recency feed.
              Passing <code>freshness</code> is what makes it behave like news.
            </p>
          )}

          <p className="flagnote">
            {data.meta.callsMade} API calls · {data.meta.elapsedMs}ms
            {data.meta.budgetRemaining !== null &&
              ` · ${data.meta.budgetRemaining} left in today's budget`}
          </p>

          <div className="source-lists">
            {data.configs.map((c) => (
              <div key={c.name} className="column">
                <h2>
                  {c.name} <small>{c.summary.resultCount} results</small>
                </h2>
                <ol>
                  {c.results.map((r) => (
                    <li key={r.url}>
                      <div className="body">
                        <a href={r.url} target="_blank" rel="noreferrer" className="title">
                          {r.title ?? r.url}
                        </a>
                        <span className="url">
                          {r.outlet} · {r.age ?? 'undated'}
                        </span>
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
          Pick freshness windows and Goggles above, then hit <strong>Run</strong>.
        </p>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { DiffReport, DiffRow, SearchResult } from '../../lib/types.js'
import { PRESETS } from '../presets.js'
import { MetricsStrip } from './MetricsStrip.js'
import { ResultColumn } from './ResultColumn.js'
import { Legend } from './Legend.js'
import { QuerySet } from './QuerySet.js'

interface CompareResponse {
  query: string
  baseline: SearchResult[]
  goggled: SearchResult[]
  diff: DiffReport
  meta: {
    baselineCached: boolean
    callsMade: number
    budgetRemaining: number | null
    elapsedMs: number
    fetchCount: number
    displayCount: number
    mutatedByGoggles: Record<string, boolean>
  }
}

interface Props {
  query: string
  setQuery: (q: string) => void
}

export function RankingDiff({ query, setQuery }: Props) {
  const first = PRESETS[0]!
  const [goggle, setGoggle] = useState(first.goggle)
  const [data, setData] = useState<CompareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Deliberately fired by a button, never by typing: each run costs up to two
  // Brave API calls and the free plan is metered per request.
  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, goggle }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error([json.error, json.hint].filter(Boolean).join(' — '))
      setData(json as CompareResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  function loadPreset(name: string) {
    const p = PRESETS.find((x) => x.name === name)
    if (!p) return
    setQuery(p.query)
    setGoggle(p.goggle)
  }

  const byUrl = new Map<string, DiffRow>()
  for (const row of data?.diff.rows ?? []) byUrl.set(row.url, row)

  return (
    <div className="ranking">
      <p className="lede">
        Write a Goggle, run it against a live query, and see what it did to the ranking —
        including what it broke.
      </p>

      <section className="controls">
        <div className="row">
          <label className="grow">
            <span>Query</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && run()}
              placeholder="python sqlite tutorial"
            />
          </label>
          <label>
            <span>Preset</span>
            <select defaultValue={first.name} onChange={(e) => loadPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <button className="run" onClick={run} disabled={loading || !query.trim()}>
            {loading ? 'Running…' : 'Run compare'}
          </button>
        </div>

        <label className="goggle">
          <span>
            Goggle <em>— sent inline, nothing needs hosting or registering</em>
          </span>
          <textarea
            value={goggle}
            onChange={(e) => setGoggle(e.target.value)}
            spellCheck={false}
            rows={8}
          />
        </label>
      </section>

      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <MetricsStrip metrics={data.diff.metrics} meta={data.meta} />
          <Legend counts={data.diff.byKind} />
          <section className="columns">
            <ResultColumn
              heading="Baseline"
              subheading="no goggle"
              results={data.baseline}
              rowFor={(url) => byUrl.get(url)}
              side="baseline"
            />
            <ResultColumn
              heading="Goggled"
              subheading={`${data.meta.callsMade} API call${data.meta.callsMade === 1 ? '' : 's'}`}
              results={data.goggled}
              rowFor={(url) => byUrl.get(url)}
              side="goggled"
            />
          </section>

          {data.diff.byKind.dropped.length > 0 && (
            <section className="fell-off">
              <h3>Fell off the page</h3>
              <ul>
                {[...data.diff.byKind.dropped, ...data.diff.byKind.pushedOut].map((r) => (
                  <li key={r.url} className={r.kind}>
                    <span className="rank">#{r.baselineRank}</span>
                    <span className="host">{r.host}</span>
                    <span className="why">
                      {r.kind === 'dropped'
                        ? 'gone from the results entirely'
                        : `sank to #${r.goggledRank}, past the page`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <QuerySet goggle={goggle} />

      {!data && !error && (
        <p className="empty">
          Pick a preset and hit <strong>Run compare</strong>.
        </p>
      )}
    </div>
  )
}

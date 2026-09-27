import type { DiffMetrics } from './types.js'

/**
 * What a Goggle did to one query.
 *
 * - `overshoot` — it pulled in results the baseline did not have anywhere in
 *   its window, which means a `$boost` reached past the pages it was aimed at.
 * - `narrowed`  — it cost host diversity without pulling anything in.
 * - `clean`     — it only reordered, or removed hosts it explicitly named.
 */
export type Verdict = 'overshoot' | 'narrowed' | 'clean'

export interface QueryOutcome {
  query: string
  metrics: DiffMetrics
  verdict: Verdict
}

export interface RunSummary {
  total: number
  overshoot: number
  narrowed: number
  clean: number
  totalPulledIn: number
  /** Median change in distinct hosts shown. Median, so one query cannot skew it. */
  medianHostDelta: number | null
  /**
   * True when more than half the set overshot. A single bad query says the
   * query was unlucky; a majority says the rule is too broad.
   */
  generalizes: boolean
}

export function verdictFor(m: DiffMetrics): Verdict {
  if (m.pulledInCount > 0) return 'overshoot'
  if (m.goggledHosts < m.baselineHosts) return 'narrowed'
  return 'clean'
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function summarizeRun(outcomes: QueryOutcome[]): RunSummary {
  const count = (v: Verdict) => outcomes.filter((o) => o.verdict === v).length
  const overshoot = count('overshoot')
  return {
    total: outcomes.length,
    overshoot,
    narrowed: count('narrowed'),
    clean: count('clean'),
    totalPulledIn: outcomes.reduce((n, o) => n + o.metrics.pulledInCount, 0),
    medianHostDelta: median(outcomes.map((o) => o.metrics.goggledHosts - o.metrics.baselineHosts)),
    generalizes: outcomes.length > 0 && overshoot > outcomes.length / 2,
  }
}

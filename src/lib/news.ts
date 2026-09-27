import { hostOf } from './diff.js'

/** The slice of a `news/search` result these metrics need. */
export interface NewsResult {
  url: string
  title?: string | null
  /** ISO timestamp. Brave also sends a human-readable `age`, which is not parseable. */
  page_age?: string | null
  age?: string | null
  meta_url?: { hostname?: string | null } | null
}

export interface NewsSummary {
  resultCount: number
  outletCount: number
  topOutlet: string | null
  topOutletShare: number
  medianAgeDays: number | null
  oldestAgeDays: number | null
  /** Results carrying no parseable date. Reported rather than quietly dropped. */
  undatedCount: number
}

export interface OutletComparison {
  shared: string[]
  added: string[]
  lost: string[]
}

function outletOf(r: NewsResult): string {
  const host = r.meta_url?.hostname
  return host ? host.toLowerCase().replace(/^www\./, '') : hostOf(r.url)
}

function ageDays(r: NewsResult, now: Date): number | null {
  const t = Date.parse(r.page_age ?? '')
  return Number.isNaN(t) ? null : (now.getTime() - t) / 86_400_000
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function summarizeNews(results: NewsResult[], now = new Date()): NewsSummary {
  const counts = new Map<string, number>()
  for (const r of results) {
    const o = outletOf(r)
    counts.set(o, (counts.get(o) ?? 0) + 1)
  }
  let topOutlet: string | null = null
  let topCount = 0
  for (const [o, c] of counts) {
    if (c > topCount) {
      topOutlet = o
      topCount = c
    }
  }

  const ages: number[] = []
  let undated = 0
  for (const r of results) {
    const d = ageDays(r, now)
    if (d === null) undated++
    else ages.push(Math.round(d))
  }

  return {
    resultCount: results.length,
    outletCount: counts.size,
    topOutlet,
    topOutletShare: results.length === 0 ? 0 : topCount / results.length,
    medianAgeDays: median(ages),
    oldestAgeDays: ages.length ? Math.max(...ages) : null,
    undatedCount: undated,
  }
}

/** Which outlets a Goggle or freshness filter added to, and removed from, the mix. */
export function compareOutlets(baseline: NewsResult[], variant: NewsResult[]): OutletComparison {
  const a = new Set(baseline.map(outletOf))
  const b = new Set(variant.map(outletOf))
  return {
    shared: [...b].filter((o) => a.has(o)),
    added: [...b].filter((o) => !a.has(o)),
    lost: [...a].filter((o) => !b.has(o)),
  }
}

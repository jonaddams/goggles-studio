import type { ChangeKind, DiffMetrics, DiffReport, DiffRow, SearchResult } from './types.js'

/**
 * Collapse the cosmetic differences between two URLs that point at the same page.
 * Scheme, a leading `www.`, a trailing slash and the fragment are all dropped;
 * the query string is kept, because it usually selects a different page.
 * Anything that fails to parse is returned unchanged so it can still be compared.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}${u.search}`
  } catch {
    return raw
  }
}

/** Hostname without a leading `www.`. Subdomains stay distinct: docs.python.org !== python.org. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return raw
  }
}

const EMPTY_BY_KIND = (): Record<ChangeKind, DiffRow[]> => ({
  promoted: [],
  demoted: [],
  unchanged: [],
  pulledIn: [],
  dropped: [],
  pushedOut: [],
})

/** 1-based rank of each normalized URL within a result list. */
function rankIndex(results: SearchResult[]): Map<string, number> {
  const m = new Map<string, number>()
  results.forEach((res, i) => {
    const key = normalizeUrl(res.url)
    if (!m.has(key)) m.set(key, i + 1)
  })
  return m
}

function classify(
  baselineRank: number | null,
  goggledRank: number | null,
  display: number,
): ChangeKind | null {
  if (baselineRank !== null && goggledRank !== null) {
    // Only rows visible on at least one side of the display window are interesting.
    if (baselineRank > display && goggledRank > display) return null
    if (goggledRank > display) return 'pushedOut'
    if (baselineRank === goggledRank) return 'unchanged'
    return goggledRank < baselineRank ? 'promoted' : 'demoted'
  }
  // Present only after the goggle: the goggle reached outside the baseline window for it.
  if (goggledRank !== null) return goggledRank <= display ? 'pulledIn' : null
  // Present only before the goggle: discarded, or sunk below the fetch window.
  if (baselineRank !== null) return baselineRank <= display ? 'dropped' : null
  return null
}

function hostStats(results: SearchResult[], display: number) {
  const counts = new Map<string, number>()
  for (const res of results.slice(0, display)) {
    const h = hostOf(res.url)
    counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  let topHost: string | null = null
  let topCount = 0
  for (const [h, c] of counts) {
    if (c > topCount) {
      topHost = h
      topCount = c
    }
  }
  const shown = Math.min(results.length, display)
  return {
    hosts: counts.size,
    topHost,
    topHostShare: shown === 0 ? 0 : topCount / shown,
  }
}

/**
 * Compare a baseline ranking against a goggled one.
 *
 * Both lists should be the full fetch window (wider than `display`). The extra
 * width is what lets `pulledIn` mean "the goggle reached outside the baseline
 * entirely" rather than "promoted from just off-screen" — the distinction that
 * makes an over-eager `$boost` visible.
 */
export function diff(
  baseline: SearchResult[],
  goggled: SearchResult[],
  display = 10,
): DiffReport {
  const baseRanks = rankIndex(baseline)
  const gogRanks = rankIndex(goggled)

  const meta = new Map<string, SearchResult>()
  for (const res of [...goggled, ...baseline]) {
    const key = normalizeUrl(res.url)
    if (!meta.has(key)) meta.set(key, res)
  }

  const rows: DiffRow[] = []
  for (const key of new Set([...baseRanks.keys(), ...gogRanks.keys()])) {
    const baselineRank = baseRanks.get(key) ?? null
    const goggledRank = gogRanks.get(key) ?? null
    const kind = classify(baselineRank, goggledRank, display)
    if (kind === null) continue
    const res = meta.get(key)!
    rows.push({
      url: res.url,
      host: hostOf(res.url),
      title: res.title,
      baselineRank,
      goggledRank,
      delta:
        baselineRank !== null && goggledRank !== null ? baselineRank - goggledRank : null,
      kind,
    })
  }

  // Goggled order first (that is the page the user is looking at), then the
  // baseline-only rows that fell off it.
  rows.sort((a, b) => (a.goggledRank ?? Infinity) - (b.goggledRank ?? Infinity)
    || (a.baselineRank ?? Infinity) - (b.baselineRank ?? Infinity))

  const byKind = EMPTY_BY_KIND()
  for (const row of rows) byKind[row.kind].push(row)

  const baseStats = hostStats(baseline, display)
  const gogStats = hostStats(goggled, display)

  let changedSlots = 0
  const slots = Math.max(
    Math.min(baseline.length, display),
    Math.min(goggled.length, display),
  )
  for (let i = 0; i < slots; i++) {
    const b = baseline[i]
    const g = goggled[i]
    if (!b || !g || normalizeUrl(b.url) !== normalizeUrl(g.url)) changedSlots++
  }

  const metrics: DiffMetrics = {
    changedSlots,
    displaySize: slots,
    changedPct: slots === 0 ? 0 : changedSlots / slots,
    baselineHosts: baseStats.hosts,
    goggledHosts: gogStats.hosts,
    topHost: gogStats.topHost,
    topHostShare: gogStats.topHostShare,
    pulledInCount: byKind.pulledIn.length,
    droppedCount: byKind.dropped.length,
  }

  return { rows, byKind, metrics }
}

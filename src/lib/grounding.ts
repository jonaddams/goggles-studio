import { hostOf, normalizeUrl } from './diff.js'

/** The slice of an `llm/context` response these metrics need. */
export interface LlmContext {
  grounding?: { generic?: { url: string; title?: string | null; snippets?: string[] }[] }
  sources?: Record<
    string,
    { title?: string | null; hostname?: string | null; age?: string[] | null }
  >
}

export interface GroundingSummary {
  sourceCount: number
  snippetCount: number
  snippetsPerSource: number
  hostCount: number
  topHost: string | null
  topHostShare: number
  /** Rough: snippet characters / 4. Enough to compare configs, not to bill against. */
  estimatedTokens: number
  medianAgeDays: number | null
}

export interface BaselineComparison {
  sharedCount: number
  uniqueCount: number
  /** Share of the variant's sources the baseline did not have. */
  replacedPct: number
  /** True when the goggle and the baseline have no source in common. */
  totalReplacement: boolean
  sharedUrls: string[]
  uniqueUrls: string[]
}

/** Snippets keyed by normalized URL, so www/trailing-slash variants collapse. */
function snippetsByUrl(ctx: LlmContext): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const item of ctx.grounding?.generic ?? []) {
    const key = normalizeUrl(item.url)
    out.set(key, [...(out.get(key) ?? []), ...(item.snippets ?? [])])
  }
  // A source may be listed without contributing a grounding snippet.
  for (const url of Object.keys(ctx.sources ?? {})) {
    const key = normalizeUrl(url)
    if (!out.has(key)) out.set(key, [])
  }
  return out
}

/** Brave reports `age` as several formats; the ISO timestamp is the parseable one. */
function ageInDays(age: string[] | null | undefined, now: Date): number | null {
  for (const raw of age ?? []) {
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return (now.getTime() - t) / 86_400_000
  }
  return null
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function summarize(ctx: LlmContext, now = new Date()): GroundingSummary {
  const byUrl = snippetsByUrl(ctx)
  const snippets = [...byUrl.values()].flat()
  const chars = snippets.reduce((n, s) => n + s.length, 0)

  const hostCounts = new Map<string, number>()
  for (const url of byUrl.keys()) {
    const h = hostOf(url.includes('://') ? url : `https://${url}`)
    hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1)
  }
  let topHost: string | null = null
  let topCount = 0
  for (const [h, c] of hostCounts) {
    if (c > topCount) {
      topHost = h
      topCount = c
    }
  }

  const ages: number[] = []
  for (const meta of Object.values(ctx.sources ?? {})) {
    const d = ageInDays(meta.age, now)
    if (d !== null) ages.push(Math.round(d))
  }

  const sourceCount = byUrl.size
  return {
    sourceCount,
    snippetCount: snippets.length,
    snippetsPerSource: sourceCount === 0 ? 0 : snippets.length / sourceCount,
    hostCount: hostCounts.size,
    topHost,
    topHostShare: sourceCount === 0 ? 0 : topCount / sourceCount,
    estimatedTokens: Math.round(chars / 4),
    medianAgeDays: median(ages),
  }
}

/**
 * How much of the variant's grounding the baseline did not already have.
 *
 * This is the same question the ranking diff asks, one layer down: a Goggle on
 * `llm/context` does not change how much text an LLM is grounded on — it changes
 * which pages that text comes from.
 */
export function compareToBaseline(baseline: LlmContext, variant: LlmContext): BaselineComparison {
  const baseUrls = new Set(snippetsByUrl(baseline).keys())
  const variantUrls = [...snippetsByUrl(variant).keys()]

  const sharedUrls = variantUrls.filter((u) => baseUrls.has(u))
  const uniqueUrls = variantUrls.filter((u) => !baseUrls.has(u))

  return {
    sharedCount: sharedUrls.length,
    uniqueCount: uniqueUrls.length,
    replacedPct: variantUrls.length === 0 ? 0 : uniqueUrls.length / variantUrls.length,
    totalReplacement: variantUrls.length > 0 && sharedUrls.length === 0,
    sharedUrls,
    uniqueUrls,
  }
}

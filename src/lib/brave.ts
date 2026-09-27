import type { SearchResult } from './types.js'

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

/**
 * Past roughly this many characters of goggle text the request URL starts to
 * risk proxy/server length limits, so we switch to the POST form of the same
 * endpoint. Brave accepts both; POST takes `goggles` as an array.
 */
const GET_GOGGLE_LIMIT = 1500

export interface SearchParams {
  query: string
  goggle?: string
  count?: number
  country?: string
}

export interface SearchResponse {
  results: SearchResult[]
  /** Brave reports this per result cluster, and only on some of them. */
  mutatedByGoggles: Record<string, boolean>
  raw: unknown
}

export class BraveApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Brave API ${status}: ${body.slice(0, 300)}`)
    this.name = 'BraveApiError'
  }
}

/** Collect every `mutated_by_goggles` flag Brave returned, keyed by its cluster. */
function collectGoggleFlags(payload: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (payload && typeof payload === 'object') {
    for (const [cluster, value] of Object.entries(payload as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'mutated_by_goggles' in value) {
        out[cluster] = Boolean((value as { mutated_by_goggles: unknown }).mutated_by_goggles)
      }
    }
  }
  return out
}

export async function search(
  { query, goggle, count = 20, country = 'us' }: SearchParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
  }

  const trimmed = goggle?.trim()
  const usePost = (trimmed?.length ?? 0) > GET_GOGGLE_LIMIT

  let res: Response
  if (usePost) {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, count, country, ...(trimmed ? { goggles: [trimmed] } : {}) }),
    })
  } else {
    const qs = new URLSearchParams({ q: query, count: String(count), country })
    if (trimmed) qs.set('goggles', trimmed)
    res = await fetchImpl(`${ENDPOINT}?${qs}`, { headers })
  }

  if (!res.ok) throw new BraveApiError(res.status, await res.text())

  const raw = (await res.json()) as { web?: { results?: SearchResult[] } }
  return {
    results: raw.web?.results ?? [],
    mutatedByGoggles: collectGoggleFlags(raw),
    raw,
  }
}

const CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context'

export interface ContextParams {
  query: string
  goggle?: string
  count?: number
}

/**
 * Fetches pre-extracted page content for grounding an LLM.
 *
 * Note: `max_tokens` is deliberately not sent. Setting it to 2048 or 16384, on
 * either GET or POST, produced the same volume of grounding as omitting it —
 * `count` is what governs how much comes back. See the README.
 */
export async function context(
  { query, goggle, count = 20 }: ContextParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
  }
  const trimmed = goggle?.trim()
  const usePost = (trimmed?.length ?? 0) > GET_GOGGLE_LIMIT

  const res = usePost
    ? await fetchImpl(CONTEXT_ENDPOINT, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, count, ...(trimmed ? { goggles: [trimmed] } : {}) }),
      })
    : await fetchImpl(
        `${CONTEXT_ENDPOINT}?${new URLSearchParams({
          q: query,
          count: String(count),
          ...(trimmed ? { goggles: trimmed } : {}),
        })}`,
        { headers },
      )

  if (!res.ok) throw new BraveApiError(res.status, await res.text())
  return res.json()
}

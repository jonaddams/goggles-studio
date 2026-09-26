import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { search, BraveApiError, type SearchResponse } from '../lib/brave.js'
import { diff } from '../lib/diff.js'
import { TtlCache, Throttle } from './cache.js'

try {
  process.loadEnvFile('.env.local')
} catch {
  // Fine when the key comes from the real environment instead.
}

const API_KEY = process.env.BRAVE_SEARCH_API_KEY
if (!API_KEY) {
  console.error('BRAVE_SEARCH_API_KEY is not set. Copy .env.example to .env.local and add your key.')
  process.exit(1)
}

/** Fetch wider than we show, so a promotion from off-screen is not mistaken for a new result. */
const FETCH_COUNT = 20
const DISPLAY_COUNT = 10

const baselineCache = new TtlCache<SearchResponse>()
const throttle = new Throttle(600)

/** Counts API calls for the session so the UI can show what an experiment cost. */
let apiCalls = 0

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true, apiCalls, cached: baselineCache.size }))

app.post('/api/compare', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  const goggle = typeof body.goggle === 'string' ? body.goggle : ''
  const country = typeof body.country === 'string' ? body.country : 'us'

  if (!query) return c.json({ error: 'query is required' }, 400)

  const started = Date.now()
  const cacheKey = `${country}::${FETCH_COUNT}::${query}`

  let baseline = baselineCache.get(cacheKey)
  const baselineCached = baseline !== undefined
  let callsMade = 0

  try {
    if (!baseline) {
      baseline = await throttle.run(() =>
        search({ query, count: FETCH_COUNT, country }, API_KEY),
      )
      callsMade++
      apiCalls++
      baselineCache.set(cacheKey, baseline)
    }

    const goggled = goggle.trim()
      ? await throttle.run(() =>
          search({ query, goggle, count: FETCH_COUNT, country }, API_KEY),
        )
      : baseline
    if (goggle.trim()) {
      callsMade++
      apiCalls++
    }

    return c.json({
      query,
      baseline: baseline.results.slice(0, DISPLAY_COUNT),
      goggled: goggled.results.slice(0, DISPLAY_COUNT),
      diff: diff(baseline.results, goggled.results, DISPLAY_COUNT),
      meta: {
        baselineCached,
        callsMade,
        apiCallsThisSession: apiCalls,
        elapsedMs: Date.now() - started,
        fetchCount: FETCH_COUNT,
        displayCount: DISPLAY_COUNT,
        // Brave sets this per result cluster and not on every one. Recorded
        // here so the UI can show what the API claimed alongside the real diff.
        mutatedByGoggles: goggled.mutatedByGoggles,
      },
    })
  } catch (err) {
    if (err instanceof BraveApiError) {
      const hint =
        err.status === 429
          ? 'Rate limited by Brave. The free plan allows about 1-2 requests per second.'
          : err.status === 401 || err.status === 403
            ? 'Brave rejected the API key. Check BRAVE_SEARCH_API_KEY in .env.local.'
            : undefined
      return c.json({ error: err.message, status: err.status, hint }, 502)
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Goggles Studio API on http://localhost:${info.port}`)
})

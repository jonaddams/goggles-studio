import { Hono } from 'hono'
import { search, BraveApiError, type SearchResponse } from '../lib/brave.js'
import { diff } from '../lib/diff.js'
import { NO_RATE_LIMIT, UNLIMITED_BUDGET, type BaselineStore, type Budget, type RateLimiter } from './ports.js'

/** Fetch wider than we show, so a promotion from off-screen is not mistaken for a new result. */
export const FETCH_COUNT = 20
export const DISPLAY_COUNT = 10

export interface AppDeps {
  apiKey: string
  baselines: BaselineStore
  budget?: Budget
  rateLimiter?: RateLimiter
  /** Serialises outbound calls. Meaningful in a long-lived Node process. */
  schedule?: <T>(fn: () => Promise<T>) => Promise<T>
  clientKey?: (req: Request) => string
}

export function createApp(deps: AppDeps) {
  const {
    apiKey,
    baselines,
    budget = UNLIMITED_BUDGET,
    rateLimiter = NO_RATE_LIMIT,
    schedule = (fn) => fn(),
    clientKey = () => 'local',
  } = deps

  const app = new Hono()

  app.get('/api/health', async (c) =>
    c.json({ ok: true, budgetRemaining: await budget.remaining() }),
  )

  app.post('/api/compare', async (c) => {
    const who = clientKey(c.req.raw)
    if (!(await rateLimiter.check(who))) {
      return c.json(
        {
          error: 'Too many compares from this address.',
          hint: 'This is a shared demo on a metered API key. Try again in a few minutes, or run it locally — see the README.',
        },
        429,
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const goggle = typeof body.goggle === 'string' ? body.goggle : ''
    const country = typeof body.country === 'string' ? body.country : 'us'
    if (!query) return c.json({ error: 'query is required' }, 400)

    const started = Date.now()
    const cacheKey = `${country}::${FETCH_COUNT}::${query}`
    const hasGoggle = goggle.trim().length > 0

    let baseline = await baselines.get(cacheKey)
    const baselineCached = baseline !== undefined

    // Reserve only the calls this run will actually make.
    const needed = (baseline ? 0 : 1) + (hasGoggle ? 1 : 0)
    if (needed > 0 && !(await budget.tryConsume(needed))) {
      return c.json(
        {
          error: "This demo's daily Brave API budget is spent.",
          hint: 'It resets at 00:00 UTC. To run it without a cap, clone the repo and use your own key — see the README.',
        },
        503,
      )
    }

    try {
      if (!baseline) {
        baseline = await schedule(() => search({ query, count: FETCH_COUNT, country }, apiKey))
        await baselines.set(cacheKey, baseline)
      }
      const goggled: SearchResponse = hasGoggle
        ? await schedule(() => search({ query, goggle, count: FETCH_COUNT, country }, apiKey))
        : baseline

      return c.json({
        query,
        baseline: baseline.results.slice(0, DISPLAY_COUNT),
        goggled: goggled.results.slice(0, DISPLAY_COUNT),
        diff: diff(baseline.results, goggled.results, DISPLAY_COUNT),
        meta: {
          baselineCached,
          callsMade: needed,
          elapsedMs: Date.now() - started,
          fetchCount: FETCH_COUNT,
          displayCount: DISPLAY_COUNT,
          budgetRemaining: await budget.remaining(),
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
              ? 'Brave rejected the API key. Check BRAVE_SEARCH_API_KEY.'
              : undefined
        return c.json({ error: err.message, status: err.status, hint }, 502)
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}

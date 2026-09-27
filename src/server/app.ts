import { Hono } from 'hono'
import { search, context, news, BraveApiError, type SearchResponse } from '../lib/brave.js'
import { diff } from '../lib/diff.js'
import { summarize, compareToBaseline, type LlmContext } from '../lib/grounding.js'
import { summarizeNews, compareOutlets, type NewsResult } from '../lib/news.js'
import { verdictFor, summarizeRun, type QueryOutcome } from '../lib/evaluate.js'
import { NO_RATE_LIMIT, UNLIMITED_BUDGET, type BaselineStore, type Budget, type RateLimiter } from './ports.js'

/** Fetch wider than we show, so a promotion from off-screen is not mistaken for a new result. */
export const FETCH_COUNT = 20
export const DISPLAY_COUNT = 10
/** A bake-off costs one API call per config, so the count is capped. */
export const MAX_GROUND_CONFIGS = 4
/** A query set costs up to two calls per query, so the set size is capped. */
export const MAX_EVAL_QUERIES = 10

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

  /**
   * Runs `llm/context` for one question under several Goggles and reports how
   * the grounding set differs. The first config is always the ungoggled
   * baseline that the rest are measured against.
   */
  app.post('/api/ground', async (c) => {
    const who = clientKey(c.req.raw)
    if (!(await rateLimiter.check(who))) {
      return c.json(
        {
          error: 'Too many runs from this address.',
          hint: 'This is a shared demo on a metered API key. Try again in a few minutes, or run it locally — see the README.',
        },
        429,
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const configs: { name: string; goggle: string }[] = Array.isArray(body.configs)
      ? body.configs
          .filter((x: unknown): x is { name: string; goggle: string } =>
            Boolean(x) && typeof (x as { name?: unknown }).name === 'string',
          )
          .slice(0, MAX_GROUND_CONFIGS)
      : []
    if (!query) return c.json({ error: 'query is required' }, 400)
    if (configs.length === 0) return c.json({ error: 'at least one config is required' }, 400)

    // A bake-off is one call per config. Reserve them together so a single run
    // cannot slip past the daily cap by spending them one at a time.
    if (!(await budget.tryConsume(configs.length))) {
      return c.json(
        {
          error: "This demo's daily Brave API budget is spent.",
          hint: 'It resets at 00:00 UTC. To run it without a cap, clone the repo and use your own key — see the README.',
        },
        503,
      )
    }

    const started = Date.now()
    try {
      const results = []
      for (const cfg of configs) {
        const at = Date.now()
        const ctx = (await schedule(() =>
          context({ query, goggle: cfg.goggle, count: FETCH_COUNT }, apiKey),
        )) as LlmContext
        results.push({
          name: cfg.name,
          goggle: cfg.goggle,
          elapsedMs: Date.now() - at,
          summary: summarize(ctx),
          sources: Object.entries(ctx.sources ?? {})
            .slice(0, 40)
            .map(([url, meta]) => ({ url, hostname: meta.hostname ?? null })),
          raw: ctx,
        })
      }

      const baseline = results[0]!
      const compared = results.map((r, i) => ({
        name: r.name,
        goggle: r.goggle,
        elapsedMs: r.elapsedMs,
        summary: r.summary,
        sources: r.sources,
        vsBaseline: i === 0 ? null : compareToBaseline(baseline.raw, r.raw),
      }))

      return c.json({
        query,
        configs: compared,
        meta: {
          callsMade: configs.length,
          elapsedMs: Date.now() - started,
          budgetRemaining: await budget.remaining(),
          fetchCount: FETCH_COUNT,
        },
      })
    } catch (err) {
      if (err instanceof BraveApiError) {
        return c.json({ error: err.message, status: err.status }, 502)
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  /**
   * Runs `news/search` under several combinations of freshness window and
   * Goggle. The first config is the baseline the rest are measured against.
   */
  app.post('/api/news', async (c) => {
    const who = clientKey(c.req.raw)
    if (!(await rateLimiter.check(who))) {
      return c.json(
        {
          error: 'Too many runs from this address.',
          hint: 'This is a shared demo on a metered API key. Try again in a few minutes, or run it locally — see the README.',
        },
        429,
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const configs: { name: string; goggle?: string; freshness?: string }[] = Array.isArray(
      body.configs,
    )
      ? body.configs
          .filter((x: unknown): x is { name: string } =>
            Boolean(x) && typeof (x as { name?: unknown }).name === 'string',
          )
          .slice(0, MAX_GROUND_CONFIGS)
      : []
    if (!query) return c.json({ error: 'query is required' }, 400)
    if (configs.length === 0) return c.json({ error: 'at least one config is required' }, 400)

    if (!(await budget.tryConsume(configs.length))) {
      return c.json(
        {
          error: "This demo's daily Brave API budget is spent.",
          hint: 'It resets at 00:00 UTC. To run it without a cap, clone the repo and use your own key — see the README.',
        },
        503,
      )
    }

    const started = Date.now()
    try {
      const runs: { cfg: (typeof configs)[number]; results: NewsResult[]; elapsedMs: number }[] = []
      for (const cfg of configs) {
        const at = Date.now()
        const r = await schedule(() =>
          news(
            { query, goggle: cfg.goggle, freshness: cfg.freshness, count: FETCH_COUNT },
            apiKey,
          ),
        )
        runs.push({ cfg, results: r.results as NewsResult[], elapsedMs: Date.now() - at })
      }

      const baseline = runs[0]!
      return c.json({
        query,
        configs: runs.map((run, i) => ({
          name: run.cfg.name,
          goggle: run.cfg.goggle ?? '',
          freshness: run.cfg.freshness ?? '',
          elapsedMs: run.elapsedMs,
          summary: summarizeNews(run.results),
          results: run.results.slice(0, 8).map((r) => ({
            url: r.url,
            title: r.title ?? null,
            age: r.age ?? null,
            outlet: r.meta_url?.hostname ?? null,
          })),
          vsBaseline: i === 0 ? null : compareOutlets(baseline.results, run.results),
        })),
        meta: {
          callsMade: configs.length,
          elapsedMs: Date.now() - started,
          budgetRemaining: await budget.remaining(),
        },
      })
    } catch (err) {
      if (err instanceof BraveApiError) return c.json({ error: err.message, status: err.status }, 502)
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  /**
   * Runs one Goggle across a set of queries. Tuning on a single query is the
   * trap Brave's own docs warn about — this is the "test set" half of that
   * advice, and it is what separates "this rule is too broad" from "that query
   * was unlucky".
   */
  app.post('/api/evaluate', async (c) => {
    const who = clientKey(c.req.raw)
    if (!(await rateLimiter.check(who))) {
      return c.json(
        {
          error: 'Too many runs from this address.',
          hint: 'This is a shared demo on a metered API key. Try again in a few minutes, or run it locally — see the README.',
        },
        429,
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const goggle = typeof body.goggle === 'string' ? body.goggle.trim() : ''
    const country = typeof body.country === 'string' ? body.country : 'us'
    const rawQueries: unknown[] = Array.isArray(body.queries) ? body.queries : []
    const queries: string[] = [
      ...new Set(
        rawQueries
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .map((q) => q.trim()),
      ),
    ].slice(0, MAX_EVAL_QUERIES)

    if (!goggle) return c.json({ error: 'goggle is required' }, 400)
    if (queries.length === 0) return c.json({ error: 'at least one query is required' }, 400)

    // Baselines already cached cost nothing, so reserve only what will be spent.
    // Re-running a set against a new Goggle is half price for exactly this reason.
    const cacheKeys = queries.map((q) => `${country}::${FETCH_COUNT}::${q}`)
    const cachedFlags = await Promise.all(cacheKeys.map(async (k) => (await baselines.get(k)) !== undefined))
    const needed = queries.length + cachedFlags.filter((hit) => !hit).length
    if (!(await budget.tryConsume(needed))) {
      return c.json(
        {
          error: "This demo's daily Brave API budget is spent.",
          hint: 'It resets at 00:00 UTC. To run it without a cap, clone the repo and use your own key — see the README.',
        },
        503,
      )
    }

    const started = Date.now()
    try {
      const outcomes: QueryOutcome[] = []
      for (const [i, query] of queries.entries()) {
        const key = cacheKeys[i]!
        let baseline = await baselines.get(key)
        if (!baseline) {
          baseline = await schedule(() => search({ query, count: FETCH_COUNT, country }, apiKey))
          await baselines.set(key, baseline)
        }
        const goggled = await schedule(() =>
          search({ query, goggle, count: FETCH_COUNT, country }, apiKey),
        )
        const metrics = diff(baseline.results, goggled.results, DISPLAY_COUNT).metrics
        outcomes.push({ query, metrics, verdict: verdictFor(metrics) })
      }

      return c.json({
        goggle,
        outcomes,
        summary: summarizeRun(outcomes),
        meta: {
          callsMade: needed,
          baselinesCached: cachedFlags.filter(Boolean).length,
          elapsedMs: Date.now() - started,
          budgetRemaining: await budget.remaining(),
        },
      })
    } catch (err) {
      if (err instanceof BraveApiError) return c.json({ error: err.message, status: err.status }, 502)
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}

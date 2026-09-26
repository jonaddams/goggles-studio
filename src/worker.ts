/**
 * Cloudflare Workers entrypoint. Serves the built SPA from the ASSETS binding
 * and handles /api/* with the same Hono app the Node server uses.
 */
import { createApp } from './server/app.js'
import type { BaselineStore, RateLimiter } from './server/ports.js'
import type { SearchResponse } from './lib/brave.js'
import { dailyBudget } from './server/budget.js'

export interface Env {
  BRAVE_SEARCH_API_KEY: string
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  /** Per-IP guard. Configured in wrangler.jsonc under `ratelimits`. */
  COMPARE_LIMIT?: { limit: (o: { key: string }) => Promise<{ success: boolean }> }
  /** Holds the day's Brave call count. */
  BUDGET?: KVNamespace
  /** Brave calls this deployment may spend per UTC day. */
  DAILY_CALL_CAP?: string
}

const DEFAULT_DAILY_CAP = 200

/**
 * Baselines live in the Cloudflare edge cache rather than a module-level Map:
 * Workers isolates are ephemeral and per-colo, so in-process state would lose
 * the baseline constantly and double the API cost of every iteration.
 */
function cacheStore(ctx: ExecutionContext): BaselineStore {
  const urlFor = (key: string) => `https://baseline.goggles.internal/${encodeURIComponent(key)}`
  return {
    async get(key) {
      const hit = await caches.default.match(new Request(urlFor(key)))
      return hit ? ((await hit.json()) as SearchResponse) : undefined
    },
    async set(key, value) {
      const res = new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=900' },
      })
      // Don't make the caller wait on the cache write.
      ctx.waitUntil(caches.default.put(new Request(urlFor(key)), res))
    },
  }
}

function bindingRateLimiter(env: Env): RateLimiter {
  const limiter = env.COMPARE_LIMIT
  if (!limiter) return { check: async () => true }
  return { check: async (key) => (await limiter.limit({ key })).success }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    if (!env.BRAVE_SEARCH_API_KEY) {
      return Response.json(
        { error: 'BRAVE_SEARCH_API_KEY secret is not set on this Worker.' },
        { status: 500 },
      )
    }

    // Fail closed. Without the KV binding there is no daily cap, and this
    // deployment is public and spends a metered key — so an unconfigured
    // budget store must refuse work rather than serve it uncapped.
    if (!env.BUDGET) {
      return Response.json(
        {
          error: 'This deployment has no budget store, so it will not spend API calls.',
          hint: 'Run `wrangler kv namespace create BUDGET` and put the id in wrangler.jsonc, then redeploy. See the README.',
        },
        { status: 503 },
      )
    }

    const app = createApp({
      apiKey: env.BRAVE_SEARCH_API_KEY,
      baselines: cacheStore(ctx),
      budget: dailyBudget(env.BUDGET, {
        cap: Number(env.DAILY_CALL_CAP ?? DEFAULT_DAILY_CAP),
        defer: (p) => ctx.waitUntil(p),
      }),
      rateLimiter: bindingRateLimiter(env),
      clientKey: (req) => req.headers.get('CF-Connecting-IP') ?? 'unknown',
      // No cross-isolate throttle exists; the rate limiter is the real guard.
    })
    return app.fetch(request)
  },
}

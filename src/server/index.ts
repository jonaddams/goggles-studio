/** Local development entrypoint. The Worker entrypoint is src/worker.ts. */
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { TtlCache, Throttle } from './cache.js'
import type { BaselineStore } from './ports.js'
import type { SearchResponse } from '../lib/brave.js'

try {
  // Resolved against the working directory, so start this from the project root.
  process.loadEnvFile('.env.local')
} catch {
  // Fine when the key comes from the real environment instead.
}

const apiKey = process.env.BRAVE_SEARCH_API_KEY
if (!apiKey) {
  console.error('BRAVE_SEARCH_API_KEY is not set. Copy .env.example to .env.local and add your key.')
  process.exit(1)
}

const memory = new TtlCache<SearchResponse>()
const baselines: BaselineStore = {
  get: async (k) => memory.get(k),
  set: async (k, v) => void memory.set(k, v),
}

// A compare fires two calls back to back, which is exactly what trips a
// per-second limit, so outbound calls are serialised with a small gap.
const throttle = new Throttle(600)

const app = createApp({ apiKey, baselines, schedule: (fn) => throttle.run(fn) })

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Goggles Studio API on http://localhost:${info.port}`)
})

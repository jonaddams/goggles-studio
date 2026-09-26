import type { SearchResponse } from '../lib/brave.js'

/**
 * Where baselines live between runs. Node keeps them in memory; the Worker uses
 * the Cloudflare Cache API, since Workers isolates are ephemeral and a
 * module-level Map would lose the cache — and with it the "one API call per
 * iteration" property the studio is built around.
 */
export interface BaselineStore {
  get(key: string): Promise<SearchResponse | undefined>
  set(key: string, value: SearchResponse): Promise<void>
}

/** Caps how much of the Brave budget a single day can spend. */
export interface Budget {
  /** Reserve `n` calls. Returns false when the day's cap is already reached. */
  tryConsume(n: number): Promise<boolean>
  remaining(): Promise<number | null>
}

/** Per-client throughput guard. Node has no real one; the Worker uses a binding. */
export interface RateLimiter {
  check(key: string): Promise<boolean>
}

export const UNLIMITED_BUDGET: Budget = {
  tryConsume: async () => true,
  remaining: async () => null,
}

export const NO_RATE_LIMIT: RateLimiter = { check: async () => true }

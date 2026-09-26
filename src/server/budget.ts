import type { Budget } from './ports.js'

/** The slice of a KV namespace the budget needs. Keeps this testable in Node. */
export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

export interface DailyBudgetOptions {
  cap: number
  /** Lets the caller defer the write; Workers passes ctx.waitUntil. */
  defer?: (p: Promise<unknown>) => void
  now?: () => Date
}

/**
 * A soft daily ceiling on Brave API spend, counted per UTC day.
 *
 * KV is eventually consistent, so simultaneous requests can overshoot the cap
 * slightly. That is acceptable here: the job is to stop a runaway bill on a
 * public demo, not to account exactly.
 */
export function dailyBudget(kv: KVLike, { cap, defer, now = () => new Date() }: DailyBudgetOptions): Budget {
  const key = () => `calls:${now().toISOString().slice(0, 10)}`
  const read = async () => {
    const raw = await kv.get(key())
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return {
    async tryConsume(n) {
      if (n <= 0) return true
      const used = await read()
      if (used + n > cap) return false
      // Expire two days out so yesterday's counter cleans itself up.
      const write = kv.put(key(), String(used + n), { expirationTtl: 172_800 })
      if (defer) defer(write)
      else await write
      return true
    },
    async remaining() {
      return Math.max(0, cap - (await read()))
    },
  }
}

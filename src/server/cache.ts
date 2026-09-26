/**
 * Baseline responses are cached so that iterating on a goggle costs one API
 * call instead of two. The free tier is $5/1k calls with ~2 requests/second,
 * and tuning a goggle means running the same query dozens of times against an
 * unchanging baseline — without this the baseline alone would burn half the
 * budget re-fetching a result the user already saw.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expires: number }>()

  constructor(
    private ttlMs = 15 * 60 * 1000,
    private max = 200,
    private now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expires <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh insertion order so the cache evicts least-recently-used.
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit.value
  }

  set(key: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: this.now() + this.ttlMs })
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * Serialises calls and keeps them at least `minGapMs` apart. Brave's plans are
 * quoted in requests per second; a compare fires two calls back to back, which
 * is exactly the pattern that trips a per-second limit.
 */
export class Throttle {
  private chain: Promise<unknown> = Promise.resolve()
  private last = Number.NEGATIVE_INFINITY

  constructor(
    private minGapMs = 600,
    private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    private now: () => number = Date.now,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.minGapMs - (this.now() - this.last)
      if (wait > 0) await this.sleep(wait)
      try {
        return await fn()
      } finally {
        this.last = this.now()
      }
    })
    // Keep the chain alive even when a call rejects.
    this.chain = next.catch(() => undefined)
    return next
  }
}

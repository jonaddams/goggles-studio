import { describe, it, expect } from 'vitest'
import { TtlCache, Throttle } from './cache.js'

describe('TtlCache', () => {
  it('returns a stored value and forgets it once the ttl passes', () => {
    let now = 0
    const c = new TtlCache<string>(1000, 10, () => now)
    c.set('k', 'v')
    expect(c.get('k')).toBe('v')
    now = 1001
    expect(c.get('k')).toBeUndefined()
    expect(c.size).toBe(0)
  })

  it('evicts the least recently used entry past the cap', () => {
    const c = new TtlCache<number>(60_000, 2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // 'a' is now the most recent, so 'b' should go first
    c.set('c', 3)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
  })
})

describe('Throttle', () => {
  it('spaces calls by at least the minimum gap', async () => {
    let now = 0
    const slept: number[] = []
    const t = new Throttle(
      600,
      async (ms) => {
        slept.push(ms)
        now += ms
      },
      () => now,
    )
    await t.run(async () => 'first')
    await t.run(async () => 'second')
    expect(slept).toEqual([600])
  })

  it('keeps running later calls after one rejects', async () => {
    const t = new Throttle(0, async () => {}, () => 0)
    await expect(t.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(t.run(async () => 'ok')).resolves.toBe('ok')
  })
})

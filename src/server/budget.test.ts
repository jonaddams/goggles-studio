import { describe, it, expect } from 'vitest'
import { dailyBudget, type KVLike } from './budget.js'

function fakeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const kv: KVLike = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
  }
  return { kv, store }
}

const AT = (iso: string) => () => new Date(iso)

describe('dailyBudget', () => {
  it('allows calls up to the cap and refuses the one that would exceed it', async () => {
    const { kv } = fakeKV()
    const b = dailyBudget(kv, { cap: 5, now: AT('2026-09-26T10:00:00Z') })
    expect(await b.tryConsume(2)).toBe(true)
    expect(await b.remaining()).toBe(3)
    expect(await b.tryConsume(3)).toBe(true)
    expect(await b.remaining()).toBe(0)
    expect(await b.tryConsume(1)).toBe(false)
  })

  it('refuses a single request larger than the whole remaining budget', async () => {
    const { kv } = fakeKV()
    const b = dailyBudget(kv, { cap: 2, now: AT('2026-09-26T10:00:00Z') })
    expect(await b.tryConsume(3)).toBe(false)
    // A refusal must not have spent anything.
    expect(await b.remaining()).toBe(2)
  })

  it('counts per UTC day, so a new day starts fresh', async () => {
    const { kv } = fakeKV()
    let clock = new Date('2026-09-26T23:59:00Z')
    const b = dailyBudget(kv, { cap: 3, now: () => clock })
    expect(await b.tryConsume(3)).toBe(true)
    expect(await b.tryConsume(1)).toBe(false)
    clock = new Date('2026-09-27T00:01:00Z')
    expect(await b.remaining()).toBe(3)
    expect(await b.tryConsume(1)).toBe(true)
  })

  it('treats a missing or corrupt counter as zero rather than blocking', async () => {
    const { kv } = fakeKV({ 'calls:2026-09-26': 'not-a-number' })
    const b = dailyBudget(kv, { cap: 4, now: AT('2026-09-26T10:00:00Z') })
    expect(await b.remaining()).toBe(4)
    expect(await b.tryConsume(1)).toBe(true)
  })

  it('consuming zero calls neither fails nor writes', async () => {
    const { kv, store } = fakeKV()
    const b = dailyBudget(kv, { cap: 1, now: AT('2026-09-26T10:00:00Z') })
    expect(await b.tryConsume(0)).toBe(true)
    expect(store.size).toBe(0)
  })

  it('hands the write to defer when one is supplied', async () => {
    const { kv } = fakeKV()
    const deferred: Promise<unknown>[] = []
    const b = dailyBudget(kv, {
      cap: 5,
      defer: (p) => deferred.push(p),
      now: AT('2026-09-26T10:00:00Z'),
    })
    expect(await b.tryConsume(1)).toBe(true)
    expect(deferred).toHaveLength(1)
    await Promise.all(deferred)
    expect(await b.remaining()).toBe(4)
  })
})

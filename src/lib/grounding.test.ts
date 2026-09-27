import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { summarize, compareToBaseline, type LlmContext } from './grounding.js'

const ctx = (sources: Record<string, string[]>, ages: Record<string, string> = {}): LlmContext => ({
  grounding: {
    generic: Object.entries(sources).map(([url, snippets]) => ({ url, title: url, snippets })),
  },
  sources: Object.fromEntries(
    Object.keys(sources).map((u) => [
      u,
      { title: u, hostname: new URL(u).hostname, age: ages[u] ? [ages[u], ages[u]] : undefined },
    ]),
  ),
})

describe('summarize', () => {
  it('counts sources, snippets and distinct hosts', () => {
    const s = summarize(
      ctx({
        'https://a.com/1': ['one', 'two'],
        'https://a.com/2': ['three'],
        'https://b.com/1': ['four'],
      }),
    )
    expect(s.sourceCount).toBe(3)
    expect(s.snippetCount).toBe(4)
    expect(s.hostCount).toBe(2)
  })

  it('estimates tokens from snippet text and reports snippet density', () => {
    const s = summarize(ctx({ 'https://a.com/1': ['x'.repeat(400)], 'https://a.com/2': ['y'.repeat(400)] }))
    expect(s.estimatedTokens).toBe(200) // 800 chars / 4
    expect(s.snippetsPerSource).toBe(1)
  })

  it('treats www and a trailing slash as the same source', () => {
    const s = summarize(ctx({ 'https://www.a.com/p/': ['one'], 'https://a.com/p': ['two'] }))
    expect(s.sourceCount).toBe(1)
    expect(s.snippetCount).toBe(2)
  })

  it('reports the host holding the largest share of sources', () => {
    const s = summarize(
      ctx({ 'https://a.com/1': ['x'], 'https://a.com/2': ['x'], 'https://b.com/1': ['x'] }),
    )
    expect(s.topHost).toBe('a.com')
    expect(s.topHostShare).toBeCloseTo(2 / 3)
  })

  it('handles an empty context without dividing by zero', () => {
    const s = summarize({ grounding: { generic: [] }, sources: {} })
    expect(s.sourceCount).toBe(0)
    expect(s.snippetsPerSource).toBe(0)
    expect(s.topHostShare).toBe(0)
    expect(s.topHost).toBeNull()
    expect(s.medianAgeDays).toBeNull()
  })

  it('takes the median age across sources that report one', () => {
    const now = new Date('2026-09-27T00:00:00Z')
    const s = summarize(
      ctx(
        { 'https://a.com/1': ['x'], 'https://b.com/1': ['x'], 'https://c.com/1': ['x'] },
        {
          'https://a.com/1': '2026-09-26T00:00:00Z', // 1 day
          'https://b.com/1': '2026-09-17T00:00:00Z', // 10 days
          'https://c.com/1': '2026-08-28T00:00:00Z', // 30 days
        },
      ),
      now,
    )
    expect(s.medianAgeDays).toBe(10)
  })
})

describe('compareToBaseline', () => {
  const base = ctx({ 'https://a.com/1': ['x'], 'https://b.com/1': ['x'], 'https://c.com/1': ['x'] })

  it('reports a surgical goggle as mostly shared', () => {
    const variant = ctx({ 'https://a.com/1': ['x'], 'https://b.com/1': ['x'], 'https://d.com/1': ['x'] })
    const c = compareToBaseline(base, variant)
    expect(c.sharedCount).toBe(2)
    expect(c.uniqueCount).toBe(1)
    expect(c.replacedPct).toBeCloseTo(1 / 3)
  })

  it('reports a total replacement when nothing is shared', () => {
    const variant = ctx({ 'https://x.com/1': ['x'], 'https://y.com/1': ['x'] })
    const c = compareToBaseline(base, variant)
    expect(c.sharedCount).toBe(0)
    expect(c.replacedPct).toBe(1)
    expect(c.totalReplacement).toBe(true)
  })

  it('does not call an identical context a replacement', () => {
    const c = compareToBaseline(base, base)
    expect(c.replacedPct).toBe(0)
    expect(c.totalReplacement).toBe(false)
  })
})

describe('against recorded llm/context responses', () => {
  const load = (f: string): LlmContext =>
    JSON.parse(readFileSync(new URL(`../../test/fixtures/${f}`, import.meta.url), 'utf8'))

  const none = load('ground-none.json')
  const docs = load('ground-docs-only.json')
  const nospam = load('ground-no-spam.json')

  it('shows a docs-only goggle replacing the grounding set outright', () => {
    const c = compareToBaseline(none, docs)
    expect(c.sharedCount).toBe(0)
    expect(c.totalReplacement).toBe(true)
    expect(summarize(docs).hostCount).toBeLessThan(summarize(none).hostCount / 4)
  })

  it('shows a targeted discard keeping most of the baseline grounding', () => {
    const c = compareToBaseline(none, nospam)
    expect(c.sharedCount).toBeGreaterThan(10)
    expect(c.totalReplacement).toBe(false)
  })

  it('confirms the volume returned barely moves across goggles', () => {
    // The Goggle changes who fills the token budget, not how much is returned.
    const [a, b, d] = [none, nospam, docs].map((x) => summarize(x).estimatedTokens)
    const spread = Math.max(a!, b!, d!) - Math.min(a!, b!, d!)
    expect(spread / Math.max(a!, b!, d!)).toBeLessThan(0.05)
  })
})

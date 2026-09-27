import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { summarizeNews, compareOutlets, type NewsResult } from './news.js'

const r = (host: string, pageAge?: string): NewsResult => ({
  url: `https://${host}/a/${Math.random().toString(36).slice(2)}`,
  title: host,
  page_age: pageAge ?? null,
  meta_url: { hostname: host },
})

const NOW = new Date('2026-09-27T00:00:00Z')

describe('summarizeNews', () => {
  it('counts results and distinct outlets', () => {
    const s = summarizeNews([r('a.com'), r('a.com'), r('b.com')], NOW)
    expect(s.resultCount).toBe(3)
    expect(s.outletCount).toBe(2)
  })

  it('reports the outlet holding the largest share', () => {
    const s = summarizeNews([r('a.com'), r('a.com'), r('a.com'), r('b.com')], NOW)
    expect(s.topOutlet).toBe('a.com')
    expect(s.topOutletShare).toBeCloseTo(0.75)
  })

  it('takes median and oldest age from page_age', () => {
    const s = summarizeNews(
      [
        r('a.com', '2026-09-26T00:00:00Z'), // 1 day
        r('b.com', '2026-09-17T00:00:00Z'), // 10 days
        r('c.com', '2026-08-28T00:00:00Z'), // 30 days
      ],
      NOW,
    )
    expect(s.medianAgeDays).toBe(10)
    expect(s.oldestAgeDays).toBe(30)
  })

  it('counts undated results instead of silently dropping them', () => {
    const s = summarizeNews([r('a.com', '2026-09-26T00:00:00Z'), r('b.com')], NOW)
    expect(s.undatedCount).toBe(1)
    expect(s.medianAgeDays).toBe(1)
  })

  it('reports nulls rather than NaN when nothing is dated', () => {
    const s = summarizeNews([r('a.com'), r('b.com')], NOW)
    expect(s.medianAgeDays).toBeNull()
    expect(s.oldestAgeDays).toBeNull()
    expect(s.undatedCount).toBe(2)
  })

  it('handles an empty result set', () => {
    const s = summarizeNews([], NOW)
    expect(s.resultCount).toBe(0)
    expect(s.outletCount).toBe(0)
    expect(s.topOutletShare).toBe(0)
    expect(s.topOutlet).toBeNull()
  })

  it('ignores a leading www when grouping outlets', () => {
    const s = summarizeNews([r('www.a.com'), r('a.com')], NOW)
    expect(s.outletCount).toBe(1)
  })
})

describe('compareOutlets', () => {
  it('reports which outlets a variant added and lost', () => {
    const base = [r('a.com'), r('b.com'), r('c.com')]
    const variant = [r('a.com'), r('d.com')]
    const c = compareOutlets(base, variant)
    expect(c.shared.sort()).toEqual(['a.com'])
    expect(c.added.sort()).toEqual(['d.com'])
    expect(c.lost.sort()).toEqual(['b.com', 'c.com'])
  })

  it('reports nothing changed for an identical set', () => {
    const base = [r('a.com'), r('b.com')]
    const c = compareOutlets(base, base)
    expect(c.added).toEqual([])
    expect(c.lost).toEqual([])
    expect(c.shared).toHaveLength(2)
  })
})

describe('against recorded news/search responses', () => {
  const load = (f: string): NewsResult[] =>
    JSON.parse(readFileSync(new URL(`../../test/fixtures/${f}`, import.meta.url), 'utf8')).results

  const unfiltered = load('news-none.json')
  const pastMonth = load('news-month.json')

  it('shows an unfiltered news query returning results years old', () => {
    // The endpoint is not a recency feed: without `freshness` it happily
    // returns evergreen pages dated well over a decade back.
    const s = summarizeNews(unfiltered, NOW)
    expect(s.oldestAgeDays).toBeGreaterThan(365 * 10)
    expect(s.resultCount).toBeGreaterThan(10)
  })

  it('shows freshness=pm trading volume for recency', () => {
    const a = summarizeNews(unfiltered, NOW)
    const b = summarizeNews(pastMonth, NOW)
    expect(b.resultCount).toBeLessThan(a.resultCount)
    expect(b.oldestAgeDays!).toBeLessThan(40)
    expect(b.medianAgeDays!).toBeLessThan(a.medianAgeDays!)
  })
})

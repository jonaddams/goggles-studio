import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diff, normalizeUrl, hostOf } from './diff.js'
import type { SearchResult } from './types.js'

const r = (url: string): SearchResult => ({ url, title: url })
const urls = (xs: string[]) => xs.map(r)

describe('normalizeUrl', () => {
  it('ignores scheme, www, trailing slash and fragment', () => {
    expect(normalizeUrl('https://www.Example.com/a/')).toBe(
      normalizeUrl('http://example.com/a#frag'),
    )
  })
  it('keeps the query string, which changes the page', () => {
    expect(normalizeUrl('https://a.com/p?x=1')).not.toBe(normalizeUrl('https://a.com/p'))
  })
  it('passes through strings that do not parse as URLs', () => {
    expect(normalizeUrl('not a url')).toBe('not a url')
  })
})

describe('hostOf', () => {
  it('strips www but keeps other subdomains distinct', () => {
    expect(hostOf('https://www.python.org/x')).toBe('python.org')
    expect(hostOf('https://docs.python.org/x')).toBe('docs.python.org')
  })
})

describe('diff', () => {
  const display = 3

  it('reports every slot unchanged when the goggle does nothing', () => {
    const list = urls(['https://a.com/1', 'https://b.com/2', 'https://c.com/3'])
    const d = diff(list, list, display)
    expect(d.byKind.unchanged).toHaveLength(3)
    expect(d.metrics.changedSlots).toBe(0)
    expect(d.metrics.changedPct).toBe(0)
    expect(d.byKind.pulledIn).toHaveLength(0)
    expect(d.byKind.dropped).toHaveLength(0)
  })

  it('marks a result absent from the goggled window as dropped', () => {
    const base = urls(['https://a.com/1', 'https://spam.com/2', 'https://c.com/3'])
    const gog = urls(['https://a.com/1', 'https://c.com/3'])
    const d = diff(base, gog, display)
    expect(d.byKind.dropped.map((x) => x.host)).toEqual(['spam.com'])
    expect(d.metrics.droppedCount).toBe(1)
  })

  it('records the rank delta for a boosted result', () => {
    const base = urls(['https://a.com/1', 'https://b.com/2', 'https://docs.com/3'])
    const gog = urls(['https://docs.com/3', 'https://a.com/1', 'https://b.com/2'])
    const d = diff(base, gog, display)
    const boosted = d.rows.find((x) => x.host === 'docs.com')!
    expect(boosted.kind).toBe('promoted')
    expect(boosted.baselineRank).toBe(3)
    expect(boosted.goggledRank).toBe(1)
    expect(boosted.delta).toBe(2)
    expect(d.byKind.demoted.map((x) => x.host)).toEqual(['a.com', 'b.com'])
  })

  it('separates pulledIn (new to the whole window) from promoted (already present)', () => {
    // Fetch window is 4 wide; display is 3.
    const base = urls([
      'https://a.com/1',
      'https://b.com/2',
      'https://c.com/3',
      'https://deep.com/4',
    ])
    const gog = urls([
      'https://new.com/x', // never in baseline at all -> pulledIn
      'https://deep.com/4', // was rank 4, outside display -> promoted
      'https://a.com/1',
      'https://b.com/2',
    ])
    const d = diff(base, gog, display)
    expect(d.byKind.pulledIn.map((x) => x.host)).toEqual(['new.com'])
    expect(d.byKind.promoted.map((x) => x.host)).toContain('deep.com')
    expect(d.metrics.pulledInCount).toBe(1)
  })

  it('calls a result pushedOut, not dropped, when it survives past the display window', () => {
    const base = urls(['https://a.com/1', 'https://b.com/2', 'https://c.com/3'])
    const gog = urls([
      'https://x.com/9',
      'https://y.com/9',
      'https://z.com/9',
      'https://b.com/2', // still present, just beyond display
    ])
    const d = diff(base, gog, display)
    expect(d.byKind.pushedOut.map((x) => x.host)).toEqual(['b.com'])
    expect(d.byKind.dropped.map((x) => x.host).sort()).toEqual(['a.com', 'c.com'])
  })

  it('flags host concentration when one boosted domain swallows the page', () => {
    const base = urls(['https://a.com/1', 'https://b.com/2', 'https://c.com/3'])
    const gog = urls(['https://d.com/1', 'https://d.com/2', 'https://d.com/3'])
    const d = diff(base, gog, display)
    expect(d.metrics.topHost).toBe('d.com')
    expect(d.metrics.topHostShare).toBe(1)
    expect(d.metrics.goggledHosts).toBe(1)
    expect(d.metrics.baselineHosts).toBe(3)
  })

  it('handles a goggled side that discarded everything', () => {
    const base = urls(['https://a.com/1', 'https://b.com/2'])
    const d = diff(base, [], display)
    expect(d.byKind.dropped).toHaveLength(2)
    expect(d.metrics.changedPct).toBe(1)
    expect(d.metrics.topHost).toBeNull()
  })
})

describe('diff against recorded Brave responses', () => {
  const load = (f: string): SearchResult[] =>
    JSON.parse(readFileSync(new URL(`../../test/fixtures/${f}`, import.meta.url), 'utf8')).web
      .results

  // Real 20-result responses for "python sqlite tutorial", baseline vs a goggle
  // that discards three content mills and boosts docs.python.org / realpython.
  const base = load('baseline-20.json')
  const gog = load('goggled-20.json')
  const report = diff(base, gog, 10)

  it('drops the three hosts the goggle discarded', () => {
    const goneHosts = new Set(report.byKind.dropped.map((x) => x.host))
    expect(goneHosts).toContain('geeksforgeeks.org')
    expect(goneHosts).toContain('tutorialspoint.com')
    expect(goneHosts).toContain('medium.com')
  })

  it('keeps a result that merely sank below the display window out of dropped', () => {
    const droppedUrls = new Set(report.byKind.dropped.map((x) => x.url))
    for (const row of report.byKind.pushedOut) {
      expect(droppedUrls.has(row.url)).toBe(false)
      expect(row.goggledRank).toBeGreaterThan(10)
    }
  })

  it('detects the boost overshoot: $boost=3 drags in pages absent from the baseline', () => {
    // Every pulled-in result comes from the boosted host, and none of them were
    // anywhere in the baseline's 20 — the boost reached past relevance.
    expect(report.metrics.pulledInCount).toBeGreaterThan(0)
    for (const row of report.byKind.pulledIn) {
      expect(row.baselineRank).toBeNull()
      expect(row.host).toBe('docs.python.org')
    }
  })

  it('shows the boosted host crowding out host diversity', () => {
    expect(report.metrics.topHost).toBe('docs.python.org')
    expect(report.metrics.topHostShare).toBeGreaterThanOrEqual(0.4)
    expect(report.metrics.goggledHosts).toBeLessThan(report.metrics.baselineHosts)
  })
})

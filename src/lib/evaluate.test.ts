import { describe, it, expect } from 'vitest'
import { verdictFor, summarizeRun, type QueryOutcome } from './evaluate.js'
import type { DiffMetrics } from './types.js'

const metrics = (over: Partial<DiffMetrics> = {}): DiffMetrics => ({
  changedSlots: 0,
  displaySize: 10,
  changedPct: 0,
  baselineHosts: 9,
  goggledHosts: 9,
  topHost: 'a.com',
  topHostShare: 0.2,
  pulledInCount: 0,
  droppedCount: 0,
  ...over,
})

const outcome = (query: string, m: Partial<DiffMetrics>): QueryOutcome => ({
  query,
  metrics: metrics(m),
  verdict: verdictFor(metrics(m)),
})

describe('verdictFor', () => {
  it('calls it an overshoot when the Goggle pulled in results absent from the baseline', () => {
    expect(verdictFor(metrics({ pulledInCount: 3 }))).toBe('overshoot')
  })

  it('overshoot wins over narrowing when both happened', () => {
    expect(verdictFor(metrics({ pulledInCount: 2, goggledHosts: 4 }))).toBe('overshoot')
  })

  it('calls it narrowed when host diversity fell without pulling anything in', () => {
    expect(verdictFor(metrics({ goggledHosts: 5 }))).toBe('narrowed')
  })

  it('calls it clean when the Goggle only reordered or removed what it named', () => {
    expect(verdictFor(metrics({ changedPct: 0.5, droppedCount: 2 }))).toBe('clean')
  })

  it('does not treat improved diversity as narrowing', () => {
    expect(verdictFor(metrics({ goggledHosts: 11 }))).toBe('clean')
  })
})

describe('summarizeRun', () => {
  it('counts verdicts across the query set', () => {
    const s = summarizeRun([
      outcome('a', { pulledInCount: 2 }),
      outcome('b', { pulledInCount: 1 }),
      outcome('c', { goggledHosts: 4 }),
      outcome('d', {}),
    ])
    expect(s.total).toBe(4)
    expect(s.overshoot).toBe(2)
    expect(s.narrowed).toBe(1)
    expect(s.clean).toBe(1)
  })

  it('reports the median host-diversity change, not the mean', () => {
    // A single extreme query should not drag the headline number.
    const s = summarizeRun([
      outcome('a', { goggledHosts: 8 }), // -1
      outcome('b', { goggledHosts: 8 }), // -1
      outcome('c', { goggledHosts: 1 }), // -8
    ])
    expect(s.medianHostDelta).toBe(-1)
  })

  it('totals the results pulled in across the whole set', () => {
    const s = summarizeRun([outcome('a', { pulledInCount: 4 }), outcome('b', { pulledInCount: 3 })])
    expect(s.totalPulledIn).toBe(7)
  })

  it('reads a majority-overshoot run as a rule problem, not a query problem', () => {
    const s = summarizeRun([
      outcome('a', { pulledInCount: 1 }),
      outcome('b', { pulledInCount: 1 }),
      outcome('c', {}),
    ])
    expect(s.generalizes).toBe(true)
  })

  it('does not claim a pattern generalizes from a single affected query', () => {
    const s = summarizeRun([outcome('a', { pulledInCount: 5 }), outcome('b', {}), outcome('c', {})])
    expect(s.generalizes).toBe(false)
  })

  it('handles an empty run', () => {
    const s = summarizeRun([])
    expect(s.total).toBe(0)
    expect(s.medianHostDelta).toBeNull()
    expect(s.generalizes).toBe(false)
  })
})

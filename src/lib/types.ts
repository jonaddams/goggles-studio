/** Minimal shape we rely on from a Brave web-search result. */
export interface SearchResult {
  url: string
  title?: string
  description?: string
}

export type ChangeKind =
  | 'promoted'
  | 'demoted'
  | 'unchanged'
  | 'pulledIn'
  | 'dropped'
  | 'pushedOut'

export interface DiffRow {
  url: string
  host: string
  title?: string
  /** 1-based rank in the baseline fetch window, or null if absent from it. */
  baselineRank: number | null
  /** 1-based rank in the goggled fetch window, or null if absent from it. */
  goggledRank: number | null
  /** Positive means the goggle moved it up. Null when it exists on only one side. */
  delta: number | null
  kind: ChangeKind
}

export interface DiffMetrics {
  /** Slots in the display window whose URL differs between the two rankings. */
  changedSlots: number
  displaySize: number
  changedPct: number
  baselineHosts: number
  goggledHosts: number
  /**
   * Largest share of the goggled display window held by a single host.
   * High values mean a boost swallowed the page — the classic overshoot.
   */
  topHostShare: number
  topHost: string | null
  pulledInCount: number
  droppedCount: number
}

export interface DiffReport {
  rows: DiffRow[]
  byKind: Record<ChangeKind, DiffRow[]>
  metrics: DiffMetrics
}

import type { DiffMetrics } from '../../lib/types.js'

interface Props {
  metrics: DiffMetrics
  meta: {
    baselineCached: boolean
    callsMade: number
    budgetRemaining: number | null
    elapsedMs: number
    mutatedByGoggles: Record<string, boolean>
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function MetricsStrip({ metrics, meta }: Props) {
  // A single host taking half the page usually means a $boost overshot.
  const crowded = metrics.topHostShare >= 0.4
  const reached = metrics.pulledInCount > 0

  return (
    <section className="metrics">
      <Tile label="Page changed" value={pct(metrics.changedPct)} sub={`${metrics.changedSlots}/${metrics.displaySize} slots`} />
      <Tile
        label="Hosts"
        value={`${metrics.baselineHosts} → ${metrics.goggledHosts}`}
        sub="distinct domains shown"
        tone={metrics.goggledHosts < metrics.baselineHosts ? 'warn' : undefined}
      />
      <Tile
        label="Top host share"
        value={pct(metrics.topHostShare)}
        sub={metrics.topHost ?? '—'}
        tone={crowded ? 'warn' : undefined}
      />
      <Tile
        label="Pulled in"
        value={String(metrics.pulledInCount)}
        sub="absent from baseline entirely"
        tone={reached ? 'warn' : undefined}
      />
      <Tile label="Dropped" value={String(metrics.droppedCount)} sub="removed from the page" />
      <Tile
        label="Cost"
        value={`${meta.callsMade} call${meta.callsMade === 1 ? '' : 's'}`}
        sub={
          meta.budgetRemaining === null
            ? meta.baselineCached
              ? 'baseline cached'
              : 'baseline fetched'
            : `${meta.budgetRemaining} left in today's budget`
        }
      />

      {(crowded || reached) && (
        <p className="overshoot">
          <strong>Boost overshoot.</strong>{' '}
          {reached && `${metrics.pulledInCount} result${metrics.pulledInCount === 1 ? ' was' : 's were'} not in the baseline's top 20 at all. `}
          {crowded && `${metrics.topHost} now holds ${pct(metrics.topHostShare)} of the page. `}
          Try a lower <code>$boost</code> value, or narrow the rule with a path pattern.
        </p>
      )}

      <p className="flagnote">
        Brave's own <code>mutated_by_goggles</code> for this response:{' '}
        <code>{JSON.stringify(meta.mutatedByGoggles)}</code> — it is reported per result
        cluster and not on <code>web</code>, so the diff above is computed locally.
      </p>
    </section>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'warn' }) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  )
}

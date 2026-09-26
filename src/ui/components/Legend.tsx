import type { ChangeKind, DiffRow } from '../../lib/types.js'

const LABELS: Record<ChangeKind, string> = {
  promoted: 'moved up',
  demoted: 'moved down',
  unchanged: 'unchanged',
  pulledIn: 'pulled in from outside the baseline',
  dropped: 'dropped',
  pushedOut: 'pushed past the page',
}

const ORDER: ChangeKind[] = ['promoted', 'pulledIn', 'demoted', 'pushedOut', 'dropped', 'unchanged']

export function Legend({ counts }: { counts: Record<ChangeKind, DiffRow[]> }) {
  return (
    <ul className="legend">
      {ORDER.filter((k) => counts[k].length > 0).map((k) => (
        <li key={k}>
          <i className={`swatch ${k}`} />
          {counts[k].length} {LABELS[k]}
        </li>
      ))}
    </ul>
  )
}

import type { DiffRow, SearchResult } from '../../lib/types.js'

interface Props {
  heading: string
  subheading: string
  results: SearchResult[]
  rowFor: (url: string) => DiffRow | undefined
  side: 'baseline' | 'goggled'
}

export function ResultColumn({ heading, subheading, results, rowFor, side }: Props) {
  return (
    <div className="column">
      <h2>
        {heading} <small>{subheading}</small>
      </h2>
      <ol>
        {results.map((res, i) => {
          const row = rowFor(res.url)
          // On the baseline side, only losses are worth colouring; on the
          // goggled side, only gains. Otherwise every row lights up twice.
          const kind = !row
            ? undefined
            : side === 'goggled'
              ? row.kind
              : row.kind === 'dropped' || row.kind === 'pushedOut' || row.kind === 'demoted'
                ? row.kind
                : undefined
          return (
            <li key={`${res.url}-${i}`} className={kind ?? ''}>
              <span className="rank">{i + 1}</span>
              <div className="body">
                <a href={res.url} target="_blank" rel="noreferrer" className="title">
                  {res.title ?? res.url}
                </a>
                <span className="url">{res.url}</span>
              </div>
              {row && side === 'goggled' && <Delta row={row} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Delta({ row }: { row: DiffRow }) {
  if (row.kind === 'pulledIn') return <span className="delta new">new</span>
  if (row.delta === null || row.delta === 0) return <span className="delta flat">—</span>
  const up = row.delta > 0
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'}
      {Math.abs(row.delta)}
    </span>
  )
}

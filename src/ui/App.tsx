import { useState } from 'react'
import { RankingDiff } from './components/RankingDiff.js'
import { BakeOff } from './components/BakeOff.js'
import { NewsMix } from './components/NewsMix.js'
import { PRESETS } from './presets.js'

type Tab = 'ranking' | 'grounding' | 'news'

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: 'ranking', label: 'Ranking diff', blurb: 'what a Goggle did to the results page' },
  { id: 'grounding', label: 'Grounding bake-off', blurb: "what it did to an LLM's sources" },
  { id: 'news', label: 'News mix', blurb: 'what it did to the outlets — and how old they are' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('ranking')
  // One query across both tabs: a short demo should only ask the viewer to hold
  // a single question in their head while the two views change around it.
  const [query, setQuery] = useState(PRESETS[0]!.query)

  return (
    <div className="app">
      <header>
        <h1>
          Goggles <span>Studio</span>
        </h1>
        <p className="tagline">
          One question, three surfaces: what a Brave Goggle <em>replaced</em> on each.
        </p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <small>{t.blurb}</small>
            </button>
          ))}
        </nav>
      </header>

      {tab === 'ranking' && <RankingDiff query={query} setQuery={setQuery} />}
      {tab === 'grounding' && <BakeOff query={query} setQuery={setQuery} />}
      {tab === 'news' && <NewsMix query={query} setQuery={setQuery} />}
    </div>
  )
}

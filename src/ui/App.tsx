import { useState } from 'react'
import { RankingDiff } from './components/RankingDiff.js'
import { BakeOff } from './components/BakeOff.js'

type Tab = 'ranking' | 'grounding'

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: 'ranking', label: 'Ranking diff', blurb: 'what a Goggle did to the results page' },
  { id: 'grounding', label: 'Grounding bake-off', blurb: "what it did to an LLM's sources" },
]

export function App() {
  const [tab, setTab] = useState<Tab>('ranking')

  return (
    <div className="app">
      <header>
        <h1>
          Goggles <span>Studio</span>
        </h1>
        <p className="tagline">
          Two views of the same question: what a Brave Goggle <em>replaced</em>.
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

      {tab === 'ranking' ? <RankingDiff /> : <BakeOff />}
    </div>
  )
}

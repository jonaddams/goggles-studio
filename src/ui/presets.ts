/** Starting points that each demonstrate a different Goggles behaviour. */
export const PRESETS: { name: string; query: string; goggle: string; note: string }[] = [
  {
    name: 'Docs over content mills',
    query: 'python sqlite tutorial',
    note: 'Discards three SEO farms and boosts official docs. Watch the boost overshoot.',
    goggle: `$discard,site=geeksforgeeks.org
$discard,site=tutorialspoint.com
$discard,site=medium.com
$boost=3,site=docs.python.org
$boost=2,site=realpython.com`,
  },
  {
    name: 'Allowlist mode',
    query: 'rust ownership',
    note: 'A bare $discard flips the default action, so only matched hosts survive.',
    goggle: `$discard
$boost,site=doc.rust-lang.org
$boost,site=rust-lang.org`,
  },
  {
    name: 'Gentle downrank',
    query: 'best noise cancelling headphones',
    note: 'Downranking nudges instead of removing. Compare the slot churn to a discard — and note how much gentler this is than adding a $boost.',
    goggle: `$downrank=3,site=reddit.com
$downrank=3,site=quora.com
$downrank=2,site=pinterest.com`,
  },
]

/** A bake-off always starts from the ungoggled baseline the rest are measured against. */
export const GROUND_CONFIGS: { name: string; goggle: string }[] = [
  { name: 'no goggle', goggle: '' },
  {
    name: 'docs only',
    goggle: `$discard
$boost,site=docs.python.org
$boost,site=sqlite.org`,
  },
  {
    name: 'no content mills',
    goggle: `$discard,site=geeksforgeeks.org
$discard,site=tutorialspoint.com
$discard,site=medium.com`,
  },
]

/**
 * A second question where the freshness gap is stark: boosting Rust's doc hosts
 * grounds on sources roughly four times staler than the baseline. Offered as a
 * one-click example so the default demo can stay on a single query.
 */
export const FRESHNESS_EXAMPLE = {
  query: 'rust async runtime tokio vs async-std',
  configs: [
    { name: 'no goggle', goggle: '' },
    {
      name: 'docs only',
      goggle: `$discard
$boost,site=doc.rust-lang.org
$boost,site=docs.rs
$boost,site=tokio.rs`,
    },
    {
      name: 'no content mills',
      goggle: `$discard,site=medium.com
$discard,site=logrocket.com
$downrank=3,site=dev.to`,
    },
  ],
}

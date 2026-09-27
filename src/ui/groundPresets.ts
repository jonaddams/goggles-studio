/** A bake-off always starts from the ungoggled baseline the rest are measured against. */
export const GROUND_QUERY = 'rust async runtime tokio vs async-std'

export const GROUND_CONFIGS: { name: string; goggle: string }[] = [
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
]

/**
 * Two independent levers on the same query: the freshness window and the
 * Goggle. The first config applies neither, which is what makes the endpoint's
 * default behaviour visible.
 */
export const NEWS_CONFIGS: { name: string; freshness?: string; goggle?: string }[] = [
  { name: 'no filters' },
  { name: 'past month', freshness: 'pm' },
  {
    name: 'past month + no mills',
    freshness: 'pm',
    goggle: `$discard,site=medium.com
$discard,site=geeksforgeeks.org
$discard,site=tutorialspoint.com`,
  },
]

export const FRESHNESS_WINDOWS = [
  { value: '', label: 'no filter' },
  { value: 'py', label: 'past year' },
  { value: 'pm', label: 'past month' },
  { value: 'pw', label: 'past week' },
  { value: 'pd', label: 'past day' },
]

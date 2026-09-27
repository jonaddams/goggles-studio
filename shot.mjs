/**
 * Regenerates docs/screenshot.png and docs/bakeoff.png. Needs `npm run dev`
 * running in another shell. Doubles as a smoke test: it fails on a console
 * error or a missing panel.
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1320, height: 1400 }, deviceScaleFactor: 2 })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: 'networkidle' })

// Ranking diff
await page.click('button.run')
await page.waitForSelector('.metrics', { timeout: 90_000 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/screenshot.png', fullPage: true })
console.log('ranking tiles:', (await page.locator('.tile-value').allTextContents()).join(' | '))

// Query set panel. Costs up to 2 calls per query, so it is opt-in: the routine
// smoke test should not spend 20 API calls.
if (process.env.SHOT_QUERYSET) {
  await page.locator('button.disclosure').click()
  await page.locator('.queryset button.run').click()
  await page.waitForSelector('.verdict-banner', { timeout: 180_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'docs/queryset.png', fullPage: true })
  console.log('query set verdict:', await page.locator('.verdict-banner strong').textContent())
  await page.locator('button.disclosure').click()
}

// Grounding bake-off
await page.getByRole('button', { name: /Grounding bake-off/ }).click()
await page.click('button.run')
await page.waitForSelector('table.bake', { timeout: 120_000 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/bakeoff.png', fullPage: true })
console.log('bake-off rows:', await page.locator('table.bake tbody tr').count())

// News mix
await page.getByRole('button', { name: /News mix/ }).click()
await page.click('button.run')
await page.waitForSelector('table.bake', { timeout: 120_000 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/newsmix.png', fullPage: true })
console.log('news rows:', await page.locator('table.bake tbody tr').count())

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
if (errors.length) process.exitCode = 1

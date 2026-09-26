/**
 * Regenerates docs/screenshot.png. Needs `npm run dev` running in another shell.
 * Doubles as a smoke test: it fails loudly on a console error or a missing panel.
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: 1320, height: 1500 },
  deviceScaleFactor: 2,
})

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.click('button.run')
await page.waitForSelector('.metrics', { timeout: 60_000 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/screenshot.png', fullPage: true })

console.log('tiles:', (await page.locator('.tile-value').allTextContents()).join(' | '))
console.log('overshoot banner:', (await page.locator('.overshoot').count()) ? 'shown' : 'absent')
console.log('console errors:', errors.length ? errors : 'none')

await browser.close()
if (errors.length) process.exitCode = 1

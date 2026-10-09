// Renders the brand HTML files to the PNGs electron-builder uses (needs Playwright's Chromium).
//   node build/brand/render.cjs
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const dir = __dirname
const out = join(dir, '..')
;(async () => {
  const browser = await chromium.launch()
  const shot = async (html, w, h, scale, file, transparent) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
    await page.goto(`file://${join(dir, html)}`)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(out, file), omitBackground: transparent })
    await page.close()
  }
  await shot('icon.html', 1024, 1024, 1, 'icon.png', true)
  await shot('dmg.html', 540, 380, 1, 'background.png', false)
  await shot('dmg.html', 540, 380, 2, 'background@2x.png', false)
  await browser.close()
  console.log('rendered icon.png, background.png, background@2x.png')
})()

import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const output = 'test-results/family-life'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:5175/admin/login')
  await page.getByRole('button', { name: /家属/ }).click()
  await page.waitForURL('**/mobile/family')
  await page.getByRole('heading', { name: '今天想看看谁？' }).waitFor()
  await page.locator('.family-member').first().waitFor()
  assert.equal(await page.locator('.family-member').count(), 2)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: output + '/selection-390.png', fullPage: true })
  await page.getByRole('button', { name: '看看家人的近况' }).click()
  await page.locator('.story-card').first().waitFor()
  await page.locator('.digest-points').waitFor()
  await page.screenshot({ path: output + '/preview-390.png' })
  await page.locator('.family-letter').scrollIntoViewIfNeeded()
  await page.screenshot({ path: output + '/letter-390.png' })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.locator('.family-letter').scrollIntoViewIfNeeded()
  await page.screenshot({ path: output + '/letter-320-viewport.png' })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS 家属桌面入口自动进入手机页面、两位虚构家人、每日寄语与手机相册布局',
  )
} finally {
  await browser.close()
}

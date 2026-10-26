import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:5175'
const output = 'test-results/entry-tasks'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? 'msedge',
})
const results = []
const runtimeErrors = []
async function check(name, run) {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.setDefaultTimeout(15000)
  try {
    await run(page)
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, passed: false, error: String(error.stack ?? error) })
    console.error('FAIL ' + name + ': ' + error.message)
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true })
  } finally {
    await context.close()
  }
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
}
async function taskListVisible(page) {
  const heading = page.locator('#care-task-list')
  await heading.waitFor()
  await page.waitForFunction(() => {
    const heading = document.getElementById('care-task-list')
    const header = document.querySelector('.mobile-header')
    if (!heading || !header) return false
    const rect = heading.getBoundingClientRect()
    return rect.top >= header.getBoundingClientRect().bottom - 1 && rect.bottom < innerHeight
  })
  assert.equal(await heading.evaluate((element) => element === document.activeElement), true)
}

try {
  for (const app of ['admin', 'mobile']) {
    await check(`${app}首页：完整新照片、四个角色入口、各屏宽无重叠`, async (page) => {
      for (const width of [1440, 1100, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 960 })
        await page.goto(`${base}/${app}/login`)
        const image = page.locator('.login-photo img')
        await image.waitFor()
        await page.waitForFunction(() => {
          const img = document.querySelector('.login-photo img')
          return img?.complete && img.naturalWidth > 0
        })
        assert.equal(await image.evaluate((img) => img.naturalWidth), 1920)
        assert.equal(await image.evaluate((img) => img.naturalHeight), 1272)
        const photo = await image.boundingBox()
        const panel = await page.locator('.role-panel').boundingBox()
        assert.ok(photo && panel)
        assert.ok(Math.abs(photo.width / photo.height - 1920 / 1272) < 0.01, '照片应保持原比例')
        assert.ok(photo.x + photo.width <= panel.x || panel.x + panel.width <= photo.x || photo.y + photo.height <= panel.y || panel.y + panel.height <= photo.y, '照片与入口不应重叠')
        if (app === 'admin' && width > 1100) assert.ok(panel.x < photo.x, '桌面入口应在照片左侧')
        else assert.ok(photo.y < panel.y, '小屏照片应在入口上方')
        assert.equal(await page.locator('.role-choice').count(), 4)
        assert.equal(await page.getByText('场景照片：Pexels').count(), 0)
        await page.getByRole('button', { name: /护理员/ }).click({ trial: true })
        await noOverflow(page)
        await page.screenshot({ path: `${output}/${app}-login-${width}.png`, fullPage: true })
      }
    })
  }
  await check('相关任务：旧筛选清除、重复点击、切换老人、前进后退与刷新', async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/mobile/login`)
    await page.getByRole('button', { name: /护理员/ }).click()
    await page.locator('.elder-work-card').first().waitFor()
    // Extra elder exists only in this isolated browser's local demo data.
    await page.evaluate(async () => {
      const { loadDemoState, updateDemoState } = await import('/packages/shared/src/demo-store.ts')
      const current = await loadDemoState()
      await updateDemoState(current.epoch, (state) => {
        state.elders.push({ ...state.elders[0], id: 'elder-regression', name: '李爷爷', bedLabel: '306床' })
        state.tasks.push({ ...state.tasks[0], id: 'task-regression', elderId: 'elder-regression', itemId: 'item-regression', title: '陪同李爷爷散步' })
      })
    })
    await page.waitForFunction(() => document.querySelectorAll('.elder-work-card').length >= 2)
    const cards = page.locator('.elder-work-card')
    assert.ok(await cards.count() >= 2, '回归场景需要两位老人')
    const names = await cards.locator('.elder-card-title strong').allTextContents()
    await page.goto(`${base}/mobile/caregiver?q=无匹配测试&status=cancelled&shift=早班&assignee=无匹配`)
    await page.getByRole('button', { name: `查看${names[0]}的相关任务`, exact: true }).click()
    await page.waitForURL((url) => url.searchParams.size === 1 && url.searchParams.has('elder'))
    const firstUrl = page.url()
    await taskListVisible(page)
    assert.match(await page.locator('#care-task-list').innerText(), new RegExp(`${names[0]}的相关任务`))
    assert.ok(await page.locator('.task-row').count() > 0)
    for (const name of await page.locator('.task-row .row-person strong').allTextContents()) assert.equal(name.trim(), names[0].trim())
    await page.evaluate(() => window.scrollTo(0, 0))
    const firstButton = page.getByRole('button', { name: `查看${names[0]}的相关任务`, exact: true })
    await firstButton.focus()
    await firstButton.press('Enter')
    await taskListVisible(page)
    await page.getByRole('button', { name: `查看${names[1]}的相关任务`, exact: true }).click()
    await page.waitForURL((url) => url.href !== firstUrl)
    const secondUrl = page.url()
    await taskListVisible(page)
    assert.match(await page.locator('#care-task-list').innerText(), new RegExp(`${names[1]}的相关任务`))
    await page.goBack()
    await page.waitForURL(firstUrl)
    await taskListVisible(page)
    await page.goForward()
    await page.waitForURL(secondUrl)
    await taskListVisible(page)
    await page.reload()
    await taskListVisible(page)
    assert.match(await page.locator('#care-task-list').innerText(), new RegExp(`${names[1]}的相关任务`))
    await noOverflow(page)
    await page.screenshot({ path: `${output}/related-tasks.png`, fullPage: false })
    await page.getByRole('button', { name: '重置筛选', exact: true }).click()
    await page.waitForURL((url) => !url.searchParams.has('elder'))
    assert.ok((await page.locator('.task-row .row-person strong').allTextContents()).some((name) => name.trim() === names[0].trim()))
    const href = await page.locator('.task-row').first().getAttribute('href')
    await page.locator('.task-row').first().click()
    await page.waitForURL(new URL(href, base).href)
    await page.locator('.editor-footer').waitFor()
  })
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify({ results, runtimeErrors }, null, 2))
}
if (runtimeErrors.length || results.some((result) => !result.passed)) process.exitCode = 1

// Requires the isolated serve_family_demo.py fixture. Never creates live data.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const base = process.env.FAMILY_API_URL || 'http://127.0.0.1:5177'
const api = process.env.FAMILY_BACKEND_URL || 'http://127.0.0.1:8769/api/v1'
const login = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'family-browser-test' }) })
assert.equal(login.status, 200, 'Requires isolated synthetic fixture')
const account = await login.json()
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const errors = []
await mkdir('test-results/issues-regression', { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' })
  await context.addInitScript(account => sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'synthetic-issues', userId: account.user_id, role: account.role, accessToken: account.access_token })), account)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/admin/dashboard')
  await page.getByRole('heading', { name: '任务状态总览', exact: true }).waitFor()
  assert.ok(await page.locator('.task-donut circle').count() > 1)
  assert.ok(await page.locator('.activity-point:not(:disabled)').count() > 0)
  assert.equal(await page.locator('.dashboard-header').evaluate(el => getComputedStyle(el).position), 'static')
  await page.locator('.legend-button').first().click()
  assert.ok(await page.locator('.drilldown li').count() > 0)
  assert.equal(await page.locator('.drilldown').evaluate(el => el === document.activeElement), true)
  assert.ok(await page.locator('.drilldown').evaluate(el => el.getBoundingClientRect().top < innerHeight))
  await page.screenshot({ path: 'test-results/issues-regression/dashboard-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/admin/dashboard')
  await page.locator('.task-donut').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.screenshot({ path: 'test-results/issues-regression/dashboard-phone.png', fullPage: true })
  // Exact schema-9 wire format: no actual time, and a legacy event with no verified registration time.
  await page.route('**/api/v1/items/ISSUE-TEST/timeline', route => route.fulfill({ json: [
    { id: 'EV-1', label: '合成回放事件', detail: '依据服务器登记时间展示', actor: '测试人员', happened_at: null, recorded_at: '2026-10-27T02:00:00Z', recorded_at_status: 'verified' },
    { id: 'EV-2', label: '旧资料待核实', detail: '未编造登记时间', actor: '测试人员', happened_at: '2026-10-25T02:00:00Z', recorded_at: null, recorded_at_status: 'unverified' },
  ] }))
  for (const prefix of ['/admin', '/mobile']) {
    await page.goto(base + prefix + '/timeline/ISSUE-TEST')
    await page.getByRole('heading', { name: '合成回放事件', exact: true }).waitFor()
    await page.getByRole('heading', { name: '旧资料待核实', exact: true }).waitFor()
    assert.ok((await page.locator('body').innerText()).includes('登记日期待核实'))
    assert.equal(await page.getByText(/接口返回结构不匹配/).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  }
  await page.goto(base + '/mobile/records/new')
  await page.locator('.elder-workspace > .workspace-panel select').first().selectOption({ index: 1 })
  // The warning class belongs to the photo panel, while action-specific feedback remains separate.
  await page.getByText('AI辅助结果可能有误，请人工核对。涉及诊断和处置，请由有权限的专业人员决定。', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS dashboard real-fixture charts, click focus/scroll, responsive layout, admin/mobile schema9 replay, concise photo reminder')
} finally { await browser.close() }

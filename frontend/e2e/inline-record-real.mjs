// Run against serve_family_demo.py only: all data and AI results are synthetic.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.FAMILY_API_URL || 'http://127.0.0.1:5177'
const api = process.env.FAMILY_BACKEND_URL || 'http://127.0.0.1:8769/api/v1'
const response = await fetch(api + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'family-browser-test' }),
})
assert.equal(response.status, 200, 'Requires isolated synthetic server')
const account = await response.json()
const auth = { Authorization: 'Bearer ' + account.access_token }
const elders = await (await fetch(api + '/elders', { headers: auth })).json()
const shifts = await (await fetch(api + '/shifts', { headers: auth })).json()
const shift = shifts.find(
  (row) =>
    row.status === 'open' &&
    Date.parse(row.start_at) <= Date.now() &&
    Date.parse(row.end_at) > Date.now() + 3600000,
)
assert.ok(shift, 'Synthetic current shift is required')
const elder = elders.find((row) => row.name === '张阿姨')
assert.ok(elder)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
await context.addInitScript((account) => {
  sessionStorage.setItem(
    'hulao:session:v2',
    JSON.stringify({
      mode: 'api',
      accountKey: 'synthetic-inline-admin',
      userId: account.user_id,
      role: account.role,
      accessToken: account.access_token,
    }),
  )
}, account)
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(
    base + '/mobile/records/new?elder=' + encodeURIComponent(elder.id),
  )
  await page
    .getByLabel('本次记录', { exact: true })
    .fill('我每天午休后愿意听京剧，请联系家属反馈情况。')
  await page.getByLabel(/^照护场景/).selectOption('activity')
  const savedResponse = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.endsWith('/elders/' + elder.id + '/record'),
  )
  await page.getByRole('button', { name: '保存并分析', exact: true }).click()
  const saved = await (await savedResponse).json()
  assert.equal(saved.analysis_status, 'ready')
  await page.getByLabel(/^核对决定/).selectOption('adopt')
  const task = page
    .locator('.record-suggestion')
    .filter({ has: page.locator('input[type="checkbox"]') })
  await task.locator('input[type="checkbox"]').check()
  await task.getByLabel(/^班次/).selectOption(shift.id)
  await task.getByLabel(/^责任人/).selectOption(shift.caregiver_ids[0])
  const due = new Date(Date.now() + 30 * 60000)
  const localDue = new Date(due.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
  await task.getByLabel('截止时间', { exact: true }).fill(localDue)
  await task.getByLabel('完成标准', { exact: true }).fill('联系后记录家属反馈')
  const confirmation = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.endsWith(
        '/analysis/' + saved.analysis.id + '/confirm',
      ),
  )
  await page.getByRole('button', { name: '保存本次核对', exact: true }).click()
  const confirmedResponse = await confirmation
  assert.equal(confirmedResponse.status(), 200)
  const confirmed = await confirmedResponse.json()
  assert.equal(confirmed.record.id, saved.record.id)
  assert.equal(confirmed.tasks.length, 1)
  assert.equal(confirmed.memories.length, 1)
  assert.equal(confirmed.tasks[0].source_record_id, saved.record.id)
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS 真实FastAPI与手机页面：保存记录→核对依据→偏好与完整任务一次确认，来源编号保持一致',
  )
} finally {
  await browser.close()
}

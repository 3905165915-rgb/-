import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.HANDOVER_REAL_URL || 'http://127.0.0.1:5181'
assert.ok(
  ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'Only isolated loopback data',
)
const output = 'test-results/handover-real'
await mkdir(output, { recursive: true })
const response = await fetch(base + '/api/v1/auth/demo-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'caregiver' }),
})
assert.equal(response.status, 200)
const login = await response.json()
assert.ok(
  login.user_id.startsWith('SYNTHETIC-'),
  'Refuse non-synthetic account',
)
async function api(path, method = 'GET', body) {
  const response = await fetch(base + '/api/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + login.access_token,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.ok(
    response.ok,
    path +
      ': ' +
      response.status +
      ' ' +
      (response.ok ? '' : await response.text()),
  )
  return response.json()
}
const before = await api('/tasks')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  timezoneId: 'America/Chicago',
})
await context.addInitScript(
  (login) =>
    sessionStorage.setItem(
      'hulao:session:v2',
      JSON.stringify({
        mode: 'api',
        accountKey: 'handover-real',
        userId: login.user_id,
        role: login.role,
        accessToken: login.access_token,
      }),
    ),
  login,
)
const page = await context.newPage(),
  errors = []
page.setDefaultTimeout(45000)
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(base + '/mobile/handover')
  const note = page.getByLabel('交班内容', { exact: true })
  await note.fill('王爷爷希望自行决定午休时间，活动前请再次询问本人意愿。')
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="刷新班次"]').disabled,
  )
  const source = await page.getByLabel('交出班次').inputValue()
  await page.getByRole('button', { name: '分析并核对', exact: true }).click()
  await page.getByLabel('摘要', { exact: true }).waitFor()
  assert.ok(
    (await page.getByLabel('摘要', { exact: true }).inputValue()).trim(),
  )
  await page.getByRole('button', { name: '核对并提交交班' }).click()
  await page
    .getByText('交班已提交，已有未完成任务沿用原编号接续。', { exact: true })
    .waitFor()
  const handovers = await api('/handovers?shift_id=' + source)
  const submitted = handovers.find(
    (row) => row.source_shift_id === source && row.status === 'submitted',
  )
  assert.ok(submitted)
  const existingTasks = submitted.items.filter((row) => row.kind === 'task')
  assert.ok(existingTasks.length)
  for (const item of submitted.items)
    await api(
      '/handovers/' + submitted.id + '/items/' + item.id + '/receive',
      'POST',
      { status: 'received' },
    )
  const after = await api('/tasks')
  assert.deepEqual(
    after.map((row) => row.id).sort(),
    before.map((row) => row.id).sort(),
  )
  for (const item of existingTasks)
    assert.equal(
      after.find((row) => row.id === item.source_id).shift_id,
      submitted.target_shift_id,
    )
  console.log(
    'PASS 真实本机后端：分析、人工核对、提交、接班成功；原任务不重复且转入下一班',
  )
  await page.getByRole('button', { name: '开始下一次交班' }).click()
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="刷新班次"]').disabled,
  )
  assert.equal(await page.getByLabel('交出班次').isEnabled(), true)
  await note.fill('请按本人意愿安排活动，并跟进原有未完成事项。')
  await page.route('**/handovers/*/ai-summary', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'AI unavailable' }),
    }),
  )
  await page.getByRole('button', { name: '分析并核对', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '分析未完成' }).waitFor()
  await page.getByRole('button', { name: '人工核对交班', exact: true }).click()
  await page.getByLabel('摘要', { exact: true }).waitFor()
  await page.getByRole('button', { name: '核对并提交交班' }).click()
  await page
    .getByText('交班已提交，已有未完成任务沿用原编号接续。', { exact: true })
    .waitFor()
  assert.equal((await api('/tasks')).length, before.length)
  assert.deepEqual(errors, [])
  await page.screenshot({
    path: output + '/manual-submitted.png',
    fullPage: true,
  })
  await writeFile(
    output + '/evidence.json',
    JSON.stringify(
      {
        status: 'passed',
        model: 'mock',
        original_tasks_preserved: true,
        manual_fallback: true,
        browser_errors: errors,
      },
      null,
      2,
    ),
  )
  console.log('PASS 真实本机后端：模型不可用时保留文字，人工核对可正式提交交班')
} catch (error) {
  console.error(await page.locator('body').innerText())
  await page.screenshot({ path: output + '/failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}

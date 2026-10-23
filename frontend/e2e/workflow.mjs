import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
const output = resolve('test-results/workflow')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const results = []
const errors = []
const elder = { id: 'ELDER-test', name: '虚构测试老人', bed_id: 'BED-test', status: 'active', revision: 1 }
const staff = { id: 'USER-test', display_name: '虚构测试护理员', role: 'caregiver', enabled: true }
const shift = { id: 'SHIFT-test', name: '虚构跨夜班', start_at: '2026-10-23T20:00:00+08:00', end_at: '2026-10-24T08:00:00+08:00', status: 'open', caregiver_ids: [staff.id], revision: 1 }
const record = { id: 'REC-test', elder_id: elder.id, raw_text: '虚构来源', observations: ['虚构观察'], revision: 1, status: 'confirmed', created_by: staff.id, created_at: '2026-10-23T00:00:00Z' }
const task = { id: 'TASK-test', elder_id: elder.id, title: '虚构回访任务', status: 'pending', shift_id: shift.id, assigned_to: staff.id, due_at: '2026-10-24T06:00:00Z', updated_at: '2026-10-23T00:00:00Z', revision: 1, source_record_id: record.id, memory_references: [] }
async function setup(role = 'caregiver') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const writes = []
  const requests = []
  const state = { failManual: false, failAI: 503, task: { ...task } }
  await context.addInitScript(({ role }) => {
    if (!sessionStorage.getItem('hulao:session:v2')) sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'isolated-' + role, userId: 'USER-test', role, accessToken: 'synthetic-not-a-real-token' }))
  }, { role })
  await context.route('**/api/v1/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1', '')
    requests.push({ path, method: req.method() })
    const json = async (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (req.method() !== 'GET') {
      writes.push({ path, key: req.headers()['idempotency-key'], body: req.postDataJSON() })
      if (path === '/records/manual') {
        if (state.failManual) { state.failManual = false; return route.abort('failed') }
        return json({ record: { ...record, raw_text: req.postDataJSON().raw_text }, tasks: [state.task] }, 201)
      }
      if (/\/records\/(context-)?extract$/.test(path)) {
        if (state.failAI === 'network') return route.abort('failed')
        return json({ detail: 'AI provider unavailable; use manual entry' }, 503)
      }
      return json(state.task)
    }
    if (path === '/elders') return json([elder])
    if (path === '/tasks') return json([state.task])
    if (path === '/tasks/TASK-test') return json(state.task)
    if (path === '/shifts') return json([shift])
    if (path === '/staff' || path === '/staff/directory') return json([staff])
    if (path === '/records') return json([record])
    if (path === '/records/REC-test') return json(record)
    if (path === '/memories/context') return json({ elder_id: elder.id, scene: 'communication', memories: [] })
    if (path.startsWith('/family/me/')) return json([])
    return json([])
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, writes, requests, state }
}
const field = (page, key) => page.locator(`[data-field="填写办理内容.${key}"]`).locator('input,textarea,select').first()
async function submit(page) {
  await page.getByRole('button', { name: '核对并继续', exact: true }).click()
  await page.getByRole('button', { name: '确认提交', exact: true }).click()
}
async function test(name, fn, role = 'caregiver') {
  const env = await setup(role)
  try { await fn(env); results.push({ name, passed: true }); console.log('PASS ' + name) }
  catch (e) {
    results.push({ name, passed: false, error: String(e.stack), body: await env.page.locator('body').innerText() })
    await env.page.screenshot({ path: resolve(output, `failure-${results.length}.png`), fullPage: true })
    console.error('FAIL ' + name + ': ' + e.message)
  } finally { await env.context.close() }
}
try {
  await test('新建任务：最后输入刷新恢复、人工字段与来源、单次提交和回执恢复', async ({ page, writes }) => {
    await page.goto(base + '/mobile/tasks/new?elder=ELDER-test')
    await field(page, 'raw_text').fill('虚构：老人希望下午沟通，最后输入')
    await page.reload()
    await field(page, 'raw_text').waitFor()
    assert.equal(await field(page, 'raw_text').inputValue(), '虚构：老人希望下午沟通，最后输入')
    await field(page, 'title').fill('虚构回访任务')
    await field(page, 'assigned_to').selectOption('USER-test')
    await field(page, 'due_at').fill('2026-10-24T14:00')
    await field(page, 'completion_criteria').fill('虚构：回访并记录本人反馈')
    await submit(page)
    await page.getByText('服务器已确认操作成功。', { exact: true }).waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].path, '/records/manual')
    assert.equal(writes[0].body.elder_id, elder.id)
    assert.equal(writes[0].body.task_candidates.length, 1)
    assert.match(writes[0].body.raw_text, /【完成标准】虚构：回访并记录本人反馈/)
    assert.ok(writes[0].key)
    await page.reload()
    assert.equal(await page.getByRole('button', { name: '本次操作已完成', exact: true }).isDisabled(), true)
    assert.equal(writes.length, 1)
  })
  await test('未知提交：刷新后复用原请求编号及原文，不重复创建', async ({ page, writes, state }) => {
    await page.goto(base + '/mobile/records/new')
    await page.getByRole('button', { name: '新建人工记录', exact: true }).click()
    await field(page, 'elder_id').selectOption(elder.id)
    await field(page, 'raw_text').fill('虚构：结果未知，不能重建')
    state.failManual = true
    await submit(page)
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).waitFor()
    await page.reload()
    assert.equal(await field(page, 'raw_text').isDisabled(), true)
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByText('服务器已确认操作成功。', { exact: true }).waitFor()
    assert.equal(writes.length, 2)
    assert.equal(writes[0].key, writes[1].key)
    assert.deepEqual(writes[0].body, writes[1].body)
  })
  await test('AI503：原文不丢失，人工模式不继承AI猜测', async ({ page, writes }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await field(page, 'scene').selectOption('communication')
    await field(page, 'text').fill('明天再看看')
    await submit(page)
    await page.getByText(/AI暂不可用/).waitFor()
    await page.getByRole('button', { name: '新建人工记录', exact: true }).click()
    assert.equal(await field(page, 'raw_text').inputValue(), '明天再看看')
    assert.equal(await field(page, 'elder_id').inputValue(), elder.id)
    assert.equal(await page.locator('[data-field="填写办理内容.task_candidates.0"]').count(), 0)
    assert.equal(writes.length, 1)
  })
  await test('AI连接中断：保留未核实请求后可人工录入，不自动确认草稿', async ({ page, state, writes }) => {
    state.failAI = 'network'
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await field(page, 'scene').selectOption('rest')
    await field(page, 'text').fill('今天想休息，明天下午再问我')
    await submit(page)
    const fallback = page.getByRole('button', { name: '保留待核实AI请求并转人工', exact: true })
    await fallback.waitFor()
    page.once('dialog', d => d.accept())
    await fallback.click()
    assert.equal(await field(page, 'raw_text').inputValue(), '今天想休息，明天下午再问我')
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':unresolved-ai:')).length), 1)
    assert.equal(writes.length, 1)
  })
  await test('多窗口版本冲突：旧表单禁止提交并保留独立恢复日志', async ({ page, context }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await field(page, 'text').fill('窗口甲原文')
    const other = await context.newPage()
    await other.goto(base + '/mobile/records/new?elder=ELDER-test')
    await field(other, 'text').fill('窗口乙新原文')
    await page.getByText(/其他窗口已修改此表单/).first().waitFor()
    await field(page, 'text').fill('窗口甲未覆盖的最后输入')
    assert.equal(await page.getByRole('button', { name: '核对并继续', exact: true }).isDisabled(), true)
    assert.ok(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.includes(':writer:') && value.includes('窗口甲未覆盖的最后输入'))))
  })
  await test('手机与桌面尺寸：核心表单无横向溢出', async ({ page }) => {
    for (const width of [320, 375, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(base + '/mobile/tasks/new?elder=ELDER-test')
      await field(page, 'raw_text').waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `mobile ${width}`)
      await page.screenshot({ path: resolve(output, `mobile-${width}.png`), fullPage: true })
    }
  })
  await test('管理端核心表单在平板与桌面尺寸无横向溢出', async ({ page }) => {
    for (const width of [768, 1366]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(base + '/admin/tasks?create=1&elder=ELDER-test')
      await field(page, 'raw_text').waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `admin ${width}`)
      await page.screenshot({ path: resolve(output, `admin-${width}.png`), fullPage: true })
    }
  }, 'admin')
  const family = await setup('family')
  try {
    await family.page.goto(base + '/mobile/tasks/new')
    await family.page.waitForURL('**/mobile/403')
    assert.equal(family.requests.length, 0)
    results.push({ name: '家属拒绝内部新建任务入口且不发内部请求', passed: true })
  } finally { await family.context.close() }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ results, runtimeErrors: errors }, null, 2))
}
if (results.some(r => !r.passed) || errors.length) process.exitCode = 1

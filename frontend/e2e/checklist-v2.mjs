import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
const output = resolve('test-results/checklist-v2')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const results = [], errors = []
const elders = [
  { id: 'ELDER-one', name: '虚构张阿姨', bed_id: 'BED-one', bed_label: '101床', current_admission_id: 'ADM-one', status: 'active', revision: 1 },
  { id: 'ELDER-two', name: '虚构李爷爷', bed_id: 'BED-two', bed_label: '102床', current_admission_id: 'ADM-two', status: 'active', revision: 1 },
]
const staff = { id: 'USER-one', display_name: '虚构护理员', role: 'caregiver', enabled: true }
const shift = { id: 'SHIFT-one', name: '虚构早班', start_at: '2026-10-25T00:00:00+08:00', end_at: '2026-10-26T00:00:00+08:00', status: 'open', caregiver_ids: [staff.id], revision: 1 }
const records = elders.map((elder, index) => ({ id: 'REC-' + (index + 1), elder_id: elder.id, admission_id: elder.current_admission_id, raw_text: '虚构人工观察' + (index + 1), observations: ['虚构人工观察' + (index + 1)], revision: 1, status: 'confirmed', created_by: staff.id, created_at: '2026-10-24T09:00:00+08:00', happened_at: '2026-10-24T08:00:00+08:00' }))
const tasks = elders.map((elder, index) => ({ id: 'TASK-' + (index + 1), elder_id: elder.id, title: '虚构关联任务' + (index + 1), status: 'pending', shift_id: shift.id, assigned_to: staff.id, due_at: '2026-10-25T15:00:00+08:00', created_at: '2026-10-24T09:00:00+08:00', updated_at: '2026-10-24T09:00:00+08:00', revision: 1, source_record_id: records[index].id, memory_references: [] }))
const drafts = [{ id: 'AI-one', elder_id: elders[0].id, shift_id: shift.id, raw_text: '虚构待核对原文', status: 'pending_review', observations: ['虚构待核对观察'], task_candidates: [], evidence: [{ quote: '虚构待核对原文' }], warnings: [], generation_kind: 'context_record', revision: 1, created_at: '2026-10-24T09:00:00+08:00', created_by: staff.id }]
async function setup(role = 'caregiver') {
  const context = await browser.newContext({ viewport: { width: role === 'caregiver' ? 390 : 1366, height: 900 } })
  const calls = [], writes = []
  const state = { drafts: structuredClone(drafts), incidents: [], failIncidents: false, failMetrics: false, invalidMetrics: false, manualCountDelta: 0, draftDelay: 0 }
  await context.addInitScript(({ role }) => sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'isolated-checklist-' + role, userId: 'USER-one', role, accessToken: 'synthetic-test-not-a-real-token' })), { role })
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', '')
    calls.push({ path, method: req.method(), query: url.search })
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postDataJSON(), key: req.headers()['idempotency-key'] })
      if (path === '/incidents') { const item = { id: 'INCIDENT-one', ...req.postDataJSON(), revision: 1, status: 'reported', created_by: staff.id }; state.incidents.push(item); return json(item, 201) }
      if (path === '/records/manual') return json({ record: records[0], tasks: [] }, 201)
      return json({ detail: 'unexpected synthetic write' }, 422)
    }
    if (path === '/elders') return json(elders)
    if (path === '/tasks') return json(tasks)
    if (/^\/tasks\/TASK-/.test(path)) return json(tasks.find(row => path.endsWith(row.id)))
    if (path === '/records') return json(records)
    if (/^\/records\/REC-/.test(path)) return json(records.find(row => path.endsWith(row.id)))
    if (path === '/records/drafts') { if (state.draftDelay) await new Promise(resolve => setTimeout(resolve, state.draftDelay)); return json(state.drafts) }
    if (path === '/records/drafts/AI-one') return json(state.drafts[0])
    if (path === '/shifts') return json([shift])
    if (path === '/staff' || path === '/staff/directory') return json([staff])
    if (path === '/incidents') return state.failIncidents ? json({ detail: 'synthetic temporarily unavailable' }, 503) : json(state.incidents)
    if (path === '/incidents/INCIDENT-one') return json(state.incidents[0])
    if (path === '/handovers') return json([])
    if (path === '/reports/metrics') {
      if (state.failMetrics) return json({ detail: 'synthetic metrics unavailable' }, 503)
      if (state.invalidMetrics) return json({ note: 'malformed aggregate must not become zero' })
      const start = url.searchParams.get('start'), end = url.searchParams.get('end')
      const lower = start + 'T00:00:00+08:00', upper = end + 'T00:00:00+08:00', asOf = start + 'T12:00:00+08:00'
      const zero = { numerator: 0, denominator: 0, ratio: null }
      return json({
        as_of: asOf, timezone: 'Asia/Shanghai', window: { start_inclusive: lower, end_exclusive: upper },
        interpretation: '虚构验收数据：区间选取业务批次，状态取当前快照。',
        generated_plan_occurrences: { completion: zero, on_time_completion: zero, cancelled: 0, not_done: 0, open_overdue: 0, excluded_future_task_rows: 0, invalid_schedule_rows: 0, definition: '仅统计已生成且已到时刻的批次' },
        manual_task_rows_created: tasks.filter(row => Date.parse(row.created_at) >= Date.parse(lower) && Date.parse(row.created_at) < Date.parse(upper) && Date.parse(row.created_at) <= Date.parse(asOf)).length + state.manualCountDelta,
        handover_receipt: { ...zero, definition: '全部提交条目为分母' },
        incidents: { reported: 0, closed: 0, open_rectifications_overdue: 0, definition: '按事件发生时间' },
        family_feedback: { created: 0, closed: 0, definition: '主管回复不代表家属满意' },
      })
    }
    if (/\/admissions$/.test(path)) return json(elders.filter(row => path.includes(row.id)).map(row => ({ id: row.current_admission_id, elder_id: row.id, status: 'active' })))
    if (path === '/memories/context') return json({ elder_id: url.searchParams.get('elder_id'), scene: url.searchParams.get('scene'), memories: [] })
    if (path.includes('impression')) return json({ detail: 'impression_no_records' }, 422)
    return json([])
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, calls, writes, state }
}
const field = (page, path) => page.locator(`[data-field="填写办理内容.${path}"]`).locator('input,textarea,select').first()
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(size.scroll <= size.width + 1, JSON.stringify(size))
}
async function test(name, fn, role) {
  const env = await setup(role)
  try { await fn(env); results.push({ name, passed: true }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, passed: false, error: String(error.stack), body: await env.page.locator('body').innerText() }); await env.page.screenshot({ path: resolve(output, 'failure-' + results.length + '.png'), fullPage: true }); console.error('FAIL ' + name + ': ' + error.message) }
  finally { await env.context.close() }
}
try {
  await test('老人工作台进入动态，按类型日期筛选并核对精确来源', async ({ page }) => {
    await page.goto(base + '/mobile/caregiver')
    await page.locator('.elder-card-title').filter({ hasText: '虚构张阿姨' }).click()
    const activity = page.getByRole('region', { name: '老人动态', exact: true })
    const list = activity.getByRole('list', { name: '当前老人的可访问动态' })
    await list.getByText('虚构人工观察1', { exact: true }).waitFor()
    assert.equal(await activity.getByText(/虚构人工观察2|虚构关联任务2/).count(), 0)
    await activity.getByRole('combobox', { name: /^类型/ }).selectOption('task')
    await activity.getByLabel('开始日期', { exact: true }).fill('2026-10-24')
    await activity.getByLabel('结束日期', { exact: true }).fill('2026-10-24')
    await activity.getByText('匹配 1 项，显示 1 项', { exact: true }).waitFor()
    await list.getByRole('button', { name: '查看来源照护记录', exact: true }).click()
    await page.getByRole('region', { name: '动态来源与详情' }).getByText('虚构人工观察1', { exact: true }).waitFor()
    await activity.getByLabel('开始日期', { exact: true }).fill('2026-10-25')
    await activity.getByLabel('结束日期', { exact: true }).fill('2026-10-25')
    await activity.getByText('当前可访问列表中暂无匹配动态。', { exact: true }).waitFor()
    for (const width of [320, 390, 430]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(page) }
    await page.screenshot({ path: resolve(output, 'mobile-elder-activity.png'), fullPage: true })
  })
  await test('任务新建按老人展示上下文，切换后清空原任务内容', async ({ page }) => {
    await page.goto(base + '/mobile/tasks/new?elder=ELDER-one')
    await page.getByRole('region', { name: '所选老人的任务与照护提示' }).getByText('虚构关联任务1', { exact: false }).waitFor()
    assert.equal(await page.getByRole('region', { name: '所选老人的任务与照护提示' }).getByText('虚构关联任务2', { exact: false }).count(), 0)
    await field(page, 'title').fill('原老人任务不能迁移')
    await field(page, 'raw_text').fill('原老人安排')
    await field(page, 'elder_id').selectOption('ELDER-two')
    assert.equal(await field(page, 'title').inputValue(), '')
    assert.equal(await field(page, 'raw_text').inputValue(), '')
    await page.getByRole('region', { name: '所选老人的任务与照护提示' }).getByText('虚构关联任务2', { exact: false }).waitFor()
    await noOverflow(page)
  })
  await test('安全人工上报不调用AI，证据只显示当前老人且单次提交', async ({ page, writes, calls }) => {
    await page.goto(base + '/mobile/safety?elder=ELDER-one&report=1')
    await field(page, 'elder_id').waitFor()
    const evidence = field(page, 'evidence.0.record_id')
    await evidence.selectOption('REC-1')
    const choices = await evidence.locator('option').evaluateAll(nodes => nodes.map(node => node.value))
    assert.ok(!choices.includes('REC-2'), 'must not offer another elder record')
    await field(page, 'evidence.0.quote').fill('虚构人工观察1')
    assert.equal(await field(page, 'admission_id').inputValue(), 'ADM-one')
    await field(page, 'occurred_at').fill('2026-10-24T10:00')
    await field(page, 'description').fill('虚构事实，人工核对')
    await field(page, 'immediate_action').fill('虚构已采取措施')
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByRole('button', { name: '确认提交', exact: true }).click()
    await page.getByText('已保存，服务器已确认成功。', { exact: true }).waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].path, '/incidents')
    assert.equal(writes[0].body.elder_id, 'ELDER-one')
    assert.ok(writes[0].key)
    assert.ok(!calls.some(call => /extract|ai-summary|speech/.test(call.path)))
    await page.screenshot({ path: resolve(output, 'mobile-safety.png'), fullPage: true })
  })
  await test('待我处理本机已读不等于处理，刷新和对象状态更新正确', async ({ page, state }) => {
    await page.goto(base + '/mobile/notifications')
    const item = page.getByRole('link', { name: /待核对记录/ })
    await item.waitFor()
    await page.getByRole('button', { name: '标记本机已读', exact: true }).click()
    assert.equal(await item.count(), 1)
    await page.reload()
    await page.getByRole('button', { name: '本机已读，仍待办理', exact: true }).waitFor()
    await page.getByLabel('只看本机未读').check()
    await page.getByText('没有符合筛选条件的事项。', { exact: true }).waitFor()
    await page.getByLabel('只看本机未读').uncheck()
    await item.click()
    await page.getByText('虚构待核对原文', { exact: true }).first().waitFor()
    assert.match(page.url(), /draft_id=AI-one/)
    state.drafts[0].status = 'confirmed'
    await page.goto(base + '/mobile/notifications')
    await page.getByText('当前可查看范围内暂无待处理事项。', { exact: true }).waitFor()
  })
  await test('家属无法进入内部安全及待处理页面，不请求内部资源', async ({ page, calls }) => {
    for (const path of ['/mobile/safety?report=1', '/mobile/notifications']) {
      await page.goto(base + path)
      await page.waitForURL(/\/403$/)
    }
    await page.goto(base + '/admin/notifications')
    await page.waitForURL(/\/admin\/family$/)
    assert.ok(!calls.some(call => ['/incidents', '/records/drafts', '/handovers'].includes(call.path)))
  }, 'family')
  await test('待处理来源失败明确提示，手机窄屏和管理端入口均无溢出', async ({ page, state }) => {
    state.failIncidents = true
    await page.goto(base + '/mobile/notifications')
    await page.getByText('安全事件暂未读取成功，可刷新重试。', { exact: true }).waitFor()
    for (const width of [320, 390, 430]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(page) }
    await page.screenshot({ path: resolve(output, 'mobile-pending-work.png'), fullPage: true })
  })
  await test('待处理迟到响应不能在同令牌切换账号后回填', async ({ page, state }) => {
    state.draftDelay = 900
    const pending = page.waitForRequest(req => new URL(req.url()).pathname === '/api/v1/records/drafts')
    await page.goto(base + '/mobile/notifications')
    await pending
    await page.evaluate(() => {
      const current = JSON.parse(sessionStorage.getItem('hulao:session:v2'))
      sessionStorage.setItem('hulao:session:v2', JSON.stringify({ ...current, accountKey: 'isolated-switched', userId: 'USER-two' }))
      window.dispatchEvent(new StorageEvent('storage'))
    })
    await page.getByText('当前可查看范围内暂无待处理事项。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('link', { name: /待核对记录/ }).count(), 0)
  })
  await test('管理看板日期、无分母、来源跳转及平板布局', async ({ page, calls }) => {
    await page.goto(base + '/admin/dashboard')
    await page.getByText('完成率 暂无分母', { exact: false }).waitFor()
    await page.getByLabel('开始日期（含）', { exact: true }).fill('2026-10-24')
    await page.getByLabel('结束日期（不含）', { exact: true }).fill('2026-10-25')
    await page.getByRole('button', { name: '应用统计窗口', exact: true }).click()
    await page.getByRole('button', { name: '手工创建任务行：2；查看授权明细', exact: true }).click()
    const detail = page.getByRole('region', { name: '手工创建任务行 · 来源核对' })
    await detail.getByText('服务器 2 · 可见同口径对象 2', { exact: true }).waitFor()
    assert.equal(await detail.getByRole('link', { name: /查看来源对象/ }).count(), 2)
    assert.ok(calls.some(row => row.path === '/reports/metrics' && row.query.includes('start=2026-10-24') && row.query.includes('end=2026-10-25')))
    for (const width of [768, 1366]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(page) }
    await page.screenshot({ path: resolve(output, 'admin-dashboard.png'), fullPage: true })
    await detail.getByRole('link', { name: '查看来源对象 TASK-1', exact: true }).click()
    await page.waitForURL(/task=TASK-1/)
    await page.getByRole('heading', { name: '虚构关联任务1', exact: true }).waitFor()
  }, 'admin')
  await test('看板加载失败可重试，拒绝畸形统计并提示来源数量差异', async ({ page, state }) => {
    state.failMetrics = true
    await page.goto(base + '/admin/dashboard')
    await page.getByRole('button', { name: '重试全部数据', exact: true }).waitFor()
    assert.equal(await page.locator('.bar-button').count(), 0)
    state.failMetrics = false; state.invalidMetrics = true
    await page.getByRole('button', { name: '重试全部数据', exact: true }).click()
    await page.getByText('统计数据格式或数值异常，请刷新后联系管理员。', { exact: true }).waitFor()
    state.invalidMetrics = false; state.manualCountDelta = 1
    await page.getByRole('button', { name: '重试全部数据', exact: true }).click()
    await page.getByText(/汇总与可见来源存在差异/).waitFor()
    await page.getByRole('button', { name: '手工创建任务行：1；查看授权明细', exact: true }).click()
    await page.getByText('服务器 1 · 可见同口径对象 0', { exact: true }).waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('hulao:unauthorized')))
    await page.waitForFunction(() => !document.querySelector('.bar-button'))
  }, 'admin')
} finally {
  await browser.close()
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, runtimeErrors: errors }, null, 2))
}
if (results.some(row => !row.passed) || errors.length) process.exitCode = 1

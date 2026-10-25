import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Synthetic contract regression, not acceptance against a running backend.
const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
const output = resolve('test-results/proactive-care')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const results = [], errors = []
const elder = { id: 'ELDER-test', name: '虚构张阿姨', status: 'active', revision: 1, bed_id: 'BED-test', current_admission_id: 'ADM-test' }
const other = { ...elder, id: 'ELDER-other', name: '虚构李爷爷', current_admission_id: 'ADM-other' }
const staff = { id: 'USER-test', display_name: '虚构护理员', role: 'caregiver', active: true }
const shift = { id: 'SHIFT-test', name: '虚构开放班', start_at: '2026-10-25T00:00:00+08:00', end_at: '2099-10-26T00:00:00+08:00', status: 'open', caregiver_ids: [staff.id], revision: 1 }
const record = { id: 'REC-test', elder_id: elder.id, admission_id: 'ADM-test', raw_text: '虚构：还是喜欢京剧，今天先休息，14点再询问本人意愿。', observations: ['虚构：还是喜欢京剧，今天先休息，14点再询问本人意愿。'], status: 'confirmed', revision: 1, created_by: staff.id, created_at: '2026-10-25T09:00:00+08:00' }
const task = { id: 'TASK-test', elder_id: elder.id, title: '14点再次询问本人意愿', completion_criteria: '询问本人并如实记录回答', status: 'pending', revision: 1, assigned_to: staff.id, shift_id: shift.id, due_at: '2099-10-25T14:00:00+08:00', source_record_id: record.id, source_revision: 1, memory_references: [], created_at: record.created_at, updated_at: record.created_at }
const memory = (extra = {}) => ({ id: 'MEM-stable', elder_id: elder.id, revision: 2, content: '虚构：喜欢京剧', category: 'stable_preference', status: 'confirmed', scenes: ['activity'], attributed_to: 'elder', source: { record_id: record.id, revision: 1, field: 'raw_text', quote: '还是喜欢京剧', snapshot_text: record.raw_text, record_status: 'confirmed', captured_at: record.created_at }, valid_from: record.created_at, expires_at: null, review_due_at: null, confirmed_by: 'SUPERVISOR-test', confirmed_at: record.created_at, created_by: staff.id, created_at: record.created_at, updated_at: record.created_at, effective: true, source_current: true, review_due: false, blocked_reasons: [], ...extra })
async function setup(role = 'caregiver', width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const writes = [], reads = []
  const state = { records: [structuredClone(record), { ...record, id: 'REC-other', elder_id: other.id, admission_id: other.current_admission_id }], task: structuredClone(task), failTask: false, delayMemory: 0, malformed: false, memories: [memory(), memory({ id: 'MEM-temp', content: '虚构：今天先休息', category: 'temporary_wish', expires_at: '2099-10-25T18:00:00+08:00' }), memory({ id: 'MEM-review', content: '虚构：变化待核实', status: 'candidate', category: 'observation', effective: false, confirmed_by: null, confirmed_at: null }), memory({ id: 'MEM-paused', content: '虚构：暂停使用的提示', status: 'suspended', effective: false })] }
  await context.addInitScript(({ role }) => { if (!sessionStorage.getItem('hulao:session:v2')) sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'proactive-' + role, userId: 'USER-test', role, accessToken: 'synthetic-not-real' })) }, { role })
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', '')
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (req.method() !== 'GET') {
      const body = req.postDataJSON(); writes.push({ path, body, key: req.headers()['idempotency-key'] })
      if (path === '/tasks') { if (state.failTask) { state.failTask = false; return route.abort('failed') } return json({ ...state.task, ...body, ...(state.invalidReceipt ? { elder_id: other.id } : {}) }, 201) }
      if (path === '/records/manual') return json({ record, tasks: [state.task] }, 201)
      if (path.endsWith('/complete')) { state.task = { ...state.task, result: body.result, status: 'completed', revision: 2 }; return json(state.task) }
      if (path.endsWith('/review')) {
        const row = state.memories.find(m => m.id === path.split('/')[2]); row.status = body.action === 'suspend' ? 'suspended' : 'confirmed'; row.revision++; row.effective = row.status === 'confirmed'; return json(row)
      }
      return json({ detail: 'unexpected synthetic write' }, 422)
    }
    reads.push(path)
    if (path === '/elders') return json([elder, other])
    if (path === '/tasks') return json([state.task])
    if (path === '/tasks/TASK-test') return json(state.task)
    if (path.endsWith('/memory-references')) return json({ task_id: task.id, task_revision: state.task.revision, task_status: state.task.status, historical_only: state.task.status === 'completed', needs_review: false, as_of: record.created_at, references: [] })
    if (path === '/shifts') return json([shift])
    if (path === '/staff' || path === '/staff/directory') return json([staff])
    if (path === '/records') return json(state.records)
    if (path === '/records/REC-test') return json(state.records[0])
    if (path === '/memories/context') return json({ elder_id: url.searchParams.get('elder_id'), scene: url.searchParams.get('scene'), as_of: record.created_at, memories: [] })
    if (path === '/memories') {
      const data = structuredClone(state.memories.filter(m => m.elder_id === url.searchParams.get('elder_id')))
      if (state.malformed && data[0]) data[0].source.quote = '不属于原文的引文'
      if (state.delayMemory) await new Promise(r => setTimeout(r, state.delayMemory))
      return json(data)
    }
    if (/^\/memories\/[^/]+\/history$/.test(path)) {
      const row = state.memories.find(m => m.id === path.split('/')[2])
      return json([{ previous_revision: 1, revision: 2, action: 'memory_confirm', reason: '虚构：已核对本人原话', created_by: 'SUPERVISOR-test', created_at: record.created_at, before: { ...row, revision: 1, status: 'candidate' }, after: row }])
    }
    if (path === '/elders/ELDER-test') return json(elder)
    if (path === '/elders/ELDER-other') return json(other)
    if (path.includes('/impressions')) return json({ latest: null, history: [] })
    if (path.endsWith('/timeline')) return json({ elder_id: path.split('/')[2], events: [], total: 0, offset: 0, limit: 100, has_more: false, notice: '虚构契约' })
    if (path === '/attachments/vision/status') return json({ configured: false, model: '', warning: '虚构测试未启用' })
    if (path === '/attachments') return json({ items: [], total: 0 })
    return json([])
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, writes, reads, state }
}
const field = (page, key) => page.locator(`[data-field="填写办理内容.${key}"]`).locator('input,textarea,select').first()
async function submit(page) {
  await page.getByRole('button', { name: '核对并继续', exact: true }).click()
  await page.getByRole('button', { name: '确认提交', exact: true }).click()
}
async function fillTask(page) {
  await field(page, 'title').fill('虚构：14点再询问')
  await field(page, 'shift_id').selectOption(shift.id)
  await field(page, 'assigned_to').selectOption(staff.id)
  await field(page, 'due_at').fill('2099-10-25T14:00')
  await field(page, 'completion_criteria').fill('完成询问并记录本人反应，不强制参加活动')
}
async function chooseComplete(page) {
  const desktop = page.locator('.wf-desktop-menu')
  if (await desktop.isVisible()) return desktop.getByRole('button', { name: '提交任务完成结果', exact: true }).click()
  await page.getByRole('button', { name: '☰ 功能菜单', exact: true }).click()
  await page.getByRole('dialog', { name: '功能菜单', exact: true }).getByRole('button', { name: '提交任务完成结果', exact: true }).click()
}
async function test(name, fn, role = 'caregiver', width) {
  const env = await setup(role, width)
  try { await fn(env); results.push({ name, passed: true }); console.log('PASS ' + name) }
  catch (e) { results.push({ name, passed: false, error: String(e.stack), body: await env.page.locator('body').innerText() }); await env.page.screenshot({ path: resolve(output, 'failure-' + results.length + '.png'), fullPage: true }); console.error('FAIL ' + name + ': ' + e.message) }
  finally { await env.context.close() }
}
try {
  await test('移动端：长期偏好与临时意愿并存，展开精确依据和历史，护理员无管理写入口', async ({ page, writes }) => {
    await page.goto(base + '/mobile/elders/' + elder.id)
    const board = page.getByRole('region', { name: '已登记照护记忆' })
    await board.getByRole('heading', { name: /当前习惯/ }).waitFor()
    await board.getByRole('heading', { name: /临时意愿/ }).waitFor()
    await board.getByRole('heading', { name: /待核实变化/ }).waitFor()
    await board.getByRole('heading', { name: /暂停、停用与历史/ }).waitFor()
    const stable = board.locator('[data-memory-id="MEM-stable"]')
    await stable.getByText('查看原文依据与适用范围', { exact: true }).click()
    await stable.getByText('还是喜欢京剧', { exact: true }).waitFor()
    await stable.getByText('修订原因与历史版本', { exact: true }).click()
    await stable.getByText('操作人：SUPERVISOR-test；原因：虚构：已核对本人原话', { exact: true }).waitFor()
    assert.equal(await board.getByRole('button', { name: '确认、复核或暂停', exact: true }).count(), 0)
    assert.equal(writes.length, 0)
    await page.screenshot({ path: resolve(output, 'mobile-memories.png'), fullPage: true })
    await stable.getByRole('link', { name: '打开来源记录当前版本', exact: true }).click()
    await page.waitForURL('**/mobile/records/new?**')
    await page.getByRole('heading', { name: '记录详情', exact: true }).waitFor()
    await page.locator('.wf-results').getByText(record.raw_text, { exact: true }).first().waitFor()
    assert.equal(writes.length, 0)
  })
  await test('管理端：暂停记忆必须填写原因并带当前版本，保留原内容', async ({ page, writes }) => {
    await page.goto(base + '/admin/elders/' + elder.id)
    await page.locator('[data-memory-id="MEM-stable"]').getByRole('button', { name: '确认、复核或暂停', exact: true }).click()
    await field(page, 'action').selectOption('suspend')
    await field(page, 'reason').fill('虚构：需要重新核对本人近期意愿')
    await submit(page)
    await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].body.expected_revision, 2); assert.ok(writes[0].key)
    assert.equal(writes[0].path, '/memories/MEM-stable/review')
    await page.screenshot({ path: resolve(output, 'admin-memory-review.png'), fullPage: true })
  }, 'supervisor', 1366)
  await test('管理端：记忆来源直达当前记录，人工新建任务使用独立接口', async ({ page, writes }) => {
    await page.goto(base + '/admin/elders/' + elder.id)
    const stable = page.locator('[data-memory-id="MEM-stable"]')
    await stable.getByText('查看原文依据与适用范围', { exact: true }).click()
    await stable.getByRole('link', { name: '打开来源记录当前版本', exact: true }).click()
    await page.waitForURL('**/admin/workflows/records?**')
    await page.getByRole('heading', { name: '记录详情', exact: true }).waitFor()
    assert.equal(writes.length, 0)
    await page.goto(base + '/admin/tasks?create=1&elder=' + elder.id)
    await fillTask(page)
    await submit(page)
    await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].path, '/tasks'); assert.ok(writes[0].key)
  }, 'supervisor', 1366)
  await test('新建任务：仅选择同老人当前入住记录，保留版本与前提，不新增虚构观察', async ({ page, writes }) => {
    await page.goto(base + '/mobile/tasks/new?elder=' + elder.id)
    await fillTask(page)
    await field(page, 'source_type').selectOption('record')
    assert.equal(await field(page, 'source_id').locator('option[value="REC-other"]').count(), 0)
    await field(page, 'source_id').selectOption(record.id)
    await field(page, 'condition').fill('本人清醒且愿意沟通')
    await page.reload()
    assert.equal(await field(page, 'condition').inputValue(), '本人清醒且愿意沟通')
    await submit(page)
    await page.getByText('任务已创建，服务器已确认；请在任务列表继续核验执行条件。', { exact: true }).waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].path, '/tasks'); assert.equal(writes[0].body.source_revision, 1)
    assert.equal(writes[0].body.condition, '本人清醒且愿意沟通'); assert.equal(writes[0].body.raw_text, undefined)
  })
  await test('来源被更正：保留原版本，刷新后阻止旧来源提交', async ({ page, state, writes }) => {
    await page.goto(base + '/mobile/tasks/new?elder=' + elder.id)
    await fillTask(page); await field(page, 'source_type').selectOption('record'); await field(page, 'source_id').selectOption(record.id)
    state.records[0].revision = 2
    state.records[0].observations = ['虚构更正：本人今天仍想休息，需要重新询问。']
    await page.getByRole('button', { name: '刷新可选数据', exact: true }).click()
    await page.getByRole('region', { name: '所选来源记录', exact: true }).getByText(state.records[0].observations[0], { exact: true }).waitFor()
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByText('来源记录已变更、撤销或不属于当前入住老人，请刷新后重新核对来源。', { exact: true }).waitFor()
    assert.equal(writes.length, 0)
  })
  await test('未知创建结果：刷新后以原幂等键核实，不产生第二项任务', async ({ page, state, writes }) => {
    await page.goto(base + '/mobile/tasks/new?elder=' + elder.id); await fillTask(page); state.failTask = true
    await submit(page)
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByText('任务已创建，服务器已确认；请在任务列表继续核验执行条件。', { exact: true }).waitFor()
    assert.equal(writes.length, 2); assert.ok(writes[0].key); assert.equal(writes[0].key, writes[1].key); assert.deepEqual(writes[0].body, writes[1].body)
  })
  await test('错误成功回执：不显示已完成，保留原请求核实', async ({ page, state, writes }) => {
    state.invalidReceipt = true
    await page.goto(base + '/mobile/tasks/new?elder=' + elder.id); await fillTask(page); await submit(page)
    await page.getByText('任务回执与本次请求不匹配，请使用原请求核实结果，勿重新创建。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '本次操作已完成', exact: true }).count(), 0)
    state.invalidReceipt = false
    await page.reload()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(writes.length, 2); assert.equal(writes[0].key, writes[1].key); assert.deepEqual(writes[0].body, writes[1].body)
  })
  await test('任务详情：显示完成标准，原来源被更正后明确提示', async ({ page, state }) => {
    state.records[0].revision = 2
    await page.goto(base + '/mobile/tasks/' + task.id)
    await page.getByText(task.completion_criteria, { exact: true }).waitFor()
    await page.getByText('创建任务时引用第1版。', { exact: true }).waitFor()
    await page.getByText(/来源已更正，以下为当前记录/).waitFor()
  })
  await test('旧版待核实表单：仍向原记录路径核实，不迁移成独立任务重复提交', async ({ page, writes }) => {
    await page.goto(base + '/mobile/tasks/new?elder=' + elder.id)
    await field(page, 'title').fill('虚构旧版待核实安排')
    const legacy = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('hulao:workflow:v2:') && !k.includes(':writer:'))
      const saved = JSON.parse(localStorage.getItem(key))
      saved.operation = 'manual_api_v1_records_manual_post'; saved.phase = 'pending'; saved.body = { elder_id: 'ELDER-test', raw_text: '虚构旧版待核实安排', title: '旧版安排' }
      saved.pending = { signature: 'legacy-synthetic-signature', key: 'legacy-synthetic-key', path: '/records/manual', method: 'post', payload: { elder_id: 'ELDER-test', raw_text: '虚构旧版待核实安排', task_candidates: [{ title: '旧版安排' }] }, retryable: true }
      return { key, saved }
    })
    // Seed the old snapshot before app initialization. The current page saves
    // its own live form during beforeunload, so injecting before reload loses it.
    await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), legacy)
    await page.reload()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '使用原请求核实结果', exact: true }).click()
    await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].path, '/records/manual'); assert.equal(writes[0].key, 'legacy-synthetic-key')
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '清空表单，开始新操作', exact: true }).click()
    await field(page, 'source_type').waitFor()
  })
  await test('反馈：320px输入即刻恢复，本人拒绝与效果未知随原任务保存', async ({ page, writes }) => {
    await page.goto(base + '/mobile/tasks/' + task.id)
    await chooseComplete(page)
    await page.getByLabel('按本人反应和观察事实填写反馈', { exact: true }).check()
    await page.getByLabel('本人反应 *', { exact: true }).selectOption('declined')
    await page.getByLabel('实际执行、观察事实或本人原话 *', { exact: true }).fill('14点已询问，虚构张阿姨说先继续休息。')
    await page.reload()
    assert.equal(await page.getByLabel('实际执行、观察事实或本人原话 *', { exact: true }).inputValue(), '14点已询问，虚构张阿姨说先继续休息。')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await submit(page)
    await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].path, '/tasks/TASK-test/complete')
    assert.deepEqual(Object.keys(writes[0].body), ['result'])
    assert.match(writes[0].body.result, /明确拒绝/); assert.match(writes[0].body.result, /尚不能判断/)
    await page.screenshot({ path: resolve(output, 'feedback-320.png'), fullPage: true })
  }, 'caregiver', 320)
  await test('异常引文：不展示为有效记忆，可重试恢复', async ({ page, state }) => {
    state.malformed = true
    await page.goto(base + '/mobile/elders/' + elder.id)
    const board = page.getByRole('region', { name: '已登记照护记忆' })
    await board.getByRole('alert').waitFor()
    assert.equal(await board.locator('article').count(), 0)
    state.malformed = false; await board.getByRole('button', { name: '刷新记忆', exact: true }).click()
    await board.getByRole('heading', { name: /当前习惯/ }).waitFor()
  })
  await test('退出账号：迟到的记忆响应不能回填原老人内容', async ({ page, state }) => {
    state.delayMemory = 400
    await page.goto(base + '/mobile/elders/' + elder.id)
    await page.evaluate(() => { sessionStorage.removeItem('hulao:session:v2'); window.dispatchEvent(new Event('hulao:unauthorized')) })
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-memory-id]').count(), 0)
  })
  assert.deepEqual(errors, [], 'browser errors')
} finally { await browser.close(); await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2)) }
if (results.some(r => !r.passed) || errors.length) process.exitCode = 1

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Every API call is intercepted. No keys, real elders or live writes are used.
const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5177'
const output = 'test-results/record-tasks'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const stamp = '2026-10-24T01:00:00Z'
const elder = { id: 'ELDER-test', name: '张阿姨', status: 'active', revision: 1 }
const otherElder = { ...elder, id: 'ELDER-other', name: '李爷爷' }
const staff = [{ id: 'USER-test', display_name: '小王', role: 'caregiver', active: true }, { id: 'USER-other', display_name: '小李', role: 'caregiver', active: true }]
const shift = { id: 'SHIFT-test', name: '今天日班', status: 'open', caregiver_ids: staff.map(row => row.id), start_at: '2026-10-24T08:00:00+08:00', end_at: '2026-10-24T20:00:00+08:00' }
const raw = '张阿姨午饭吃了大半碗。明天15:00由小王负责联系家属；本人同意后，明天16:00由小王负责陪同散步。'
const source = { id: 'AI-test', elder_id: elder.id, shift_id: shift.id, revision: 1, status: 'pending_review', generation_kind: 'context_record', raw_text: raw, observations: ['张阿姨午饭吃了大半碗。'], task_candidates: [
  { title: '联系家属', evidence_text: '明天15:00由小王负责联系家属', due_text: '明天15:00', due_at: '2026-10-25T15:00:00+08:00', assigned_to: 'USER-test', review_notes: ['按原文匹配，待核对'] },
  { title: '陪同散步', evidence_text: '本人同意后，明天16:00由小王负责陪同散步', due_text: '明天16:00', due_at: '2026-10-25T16:00:00+08:00', assigned_to: 'USER-test', condition: '本人同意后' },
], evidence: [{ text: raw, type: 'current_observation' }], created_by: 'USER-test', created_at: stamp, warnings: [] }
const field = (page, key) => page.locator(`[data-field="填写办理内容.${key}"]`).locator('input,textarea,select').first()
const results = [], errors = []

async function test(name, fn, { width = 390, role = 'caregiver', candidates = source.task_candidates } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' })
  await context.addInitScript(role => sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'isolated-' + role, role, userId: 'USER-test', accessToken: 'synthetic-isolated-token' })), role)
  const draft = structuredClone({ ...source, task_candidates: candidates })
  const state = { writes: [], records: [], tasks: [], delay: 0, dropNextConfirm: false, receipt: null, savedBody: null }
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', '')
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (req.method() !== 'GET') {
      const body = req.postDataJSON()
      state.writes.push({ path, body, key: req.headers()['idempotency-key'] })
      if (path === '/records/context-extract') return json(draft)
      if (path === '/records/AI-test/confirm' || path === '/records/manual') {
        if (path.endsWith('/confirm') && state.receipt) {
          if (JSON.stringify(state.savedBody) !== JSON.stringify(body)) return json({ detail: 'draft_already_confirmed_refresh_record' }, 409)
          return json(state.receipt)
        }
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay))
        const record = { id: 'REC-test', revision: 1, elder_id: body.elder_id || elder.id, raw_text: body.raw_text || raw, observations: body.observations || [body.raw_text], created_by: staff[0].id, created_at: stamp, status: 'confirmed' }
        const tasks = (body.task_candidates || []).map((row, i) => ({ ...row, id: 'TASK-test-' + i, elder_id: record.elder_id, status: 'pending', revision: 1, created_at: stamp, updated_at: stamp, created_by: staff[0].id, source_record_id: record.id, source_revision: 1 }))
        draft.status = 'confirmed'
        state.records.push(record); state.tasks.push(...tasks)
        if (path.endsWith('/confirm')) {
          state.receipt = { record, tasks }; state.savedBody = body
          if (state.dropNextConfirm) { state.dropNextConfirm = false; return route.abort('failed') }
        }
        return json({ record, tasks })
      }
      throw new Error('Unexpected write ' + path)
    }
    return json(path === '/elders' ? [elder, otherElder]
      : ['/staff', '/staff/directory'].includes(path) ? staff
      : path === '/shifts' ? [shift]
      : path === '/records/drafts' ? [draft]
      : path === '/records/drafts/AI-test' ? draft
      : path === '/records' ? state.records
      : path === '/tasks' ? state.tasks
      : path === '/memories/context' ? { elder_id: elder.id, scene: 'general', as_of: stamp, memories: [] }
      : [])
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', e => errors.push(e.message))
  try {
    await fn({ page, state, draft })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'horizontal overflow')
    await page.screenshot({ path: `${output}/${results.length}.png`, fullPage: true })
    results.push({ name, passed: true }); console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, passed: false, error: error.stack, body: await page.locator('body').innerText() })
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true })
    console.error('FAIL ' + name + ': ' + error.message)
  } finally { await context.close() }
}
async function extract(page, management = false) {
  await page.goto(base + (management ? '/admin/workflows/records' : '/mobile/records/new?elder=ELDER-test'))
  if (management) {
    await page.getByRole('button', { name: '新增记录', exact: true }).click()
    await field(page, 'elder_id').selectOption(elder.id)
  }
  await field(page, 'scene').selectOption('activity')
  await field(page, 'text').fill(raw)
  await page.getByRole('button', { name: '核对并继续', exact: true }).click()
  await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await page.getByRole('button', { name: '核对并保存记录', exact: true }).click()
  await page.getByRole('heading', { name: /随记录创建任务/ }).waitFor()
}
async function save(page, count) {
  await page.getByRole('button', { name: '核对并继续', exact: true }).click()
  await page.getByRole('button', { name: count ? `保存记录并创建${count}项任务` : '仅保存记录', exact: true }).click()
  await page.getByText(count ? `记录已保存，同时创建了${count}项任务。可在任务列表按老人查看。` : '记录已保存，本次未创建任务。', { exact: true }).waitFor()
  await page.getByText('这条正式记录也已纳入该老人的印象资料。下次整理印象时，会结合历史记录一起分析；待办安排不等于服务已经发生，也不会直接改成长期偏好。', { exact: true }).waitFor()
}
try {
  for (const width of [320, 390, 1366]) await test(`记录随存任务完整链路 / ${width}px`, async ({ page, state }) => {
    await extract(page, width === 1366)
    assert.equal(await page.getByLabel('第1项截止时间', { exact: true }).inputValue(), '2026-10-25T15:00')
    assert.equal(await page.getByLabel('第1项负责人', { exact: true }).inputValue(), 'USER-test')
    assert.equal(await page.getByLabel('第2项执行前提', { exact: true }).inputValue(), '本人同意后')
    if (width !== 1366) assert.equal(await page.getByLabel('第1项负责人', { exact: true }).locator('option[value="USER-other"]').count(), 0)
    assert.equal(state.records.length, 0)
    await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true })
    await save(page, 2)
    assert.equal(state.records.length, 1); assert.equal(state.tasks.length, 2)
    assert.equal(state.writes.length, 2)
    assert.equal(state.writes[1].body.expected_revision, 1)
    assert.equal(state.tasks[1].condition, '本人同意后')
    assert.equal(state.writes[1].body.task_candidates[0].review_notes, undefined)
    await page.reload()
    if (width === 1366) await page.locator('.wf-record-card').filter({ hasText: '张阿姨午饭吃了大半碗。' }).waitFor()
    else await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
    assert.equal(state.writes.length, 2)
  }, { width, role: width === 1366 ? 'admin' : 'caregiver' })

  await test('模糊待办：先提示补齐，勾选本人后才能随存创建', async ({ page, state }) => {
    await extract(page)
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByText(/第1项待办：请补充负责人/).waitFor()
    assert.equal(state.writes.length, 1)
    await page.getByRole('button', { name: '本项由我负责', exact: true }).click()
    await page.getByLabel('第1项截止时间', { exact: true }).fill('2026-10-25T10:00')
    await save(page, 1)
    assert.equal(state.tasks.length, 1)
  }, { candidates: [{ title: '回访', due_text: '明天', evidence_text: '明天再看看' }] })

  await test('回执丢失：刷新后使用原请求核实，不重复生成记录任务', async ({ page, state }) => {
    await extract(page)
    state.dropNextConfirm = true
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByRole('button', { name: '保存记录并创建2项任务', exact: true }).click()
    const retry = () => page.getByRole('button', { name: '使用原请求核实结果', exact: true })
    await retry().waitFor()
    assert.equal(state.records.length, 1); assert.equal(state.tasks.length, 2)
    await page.reload()
    await retry().waitFor()
    assert.equal(await page.getByLabel('第1项要做的事', { exact: true }).isDisabled(), true)
    await retry().click()
    await retry().click()
    await page.getByText('记录已保存，同时创建了2项任务。可在任务列表按老人查看。', { exact: true }).waitFor()
    assert.equal(state.records.length, 1); assert.equal(state.tasks.length, 2)
    assert.deepEqual(state.writes[1].body, state.writes[2].body)
    assert.equal(state.writes[1].key, state.writes[2].key)
  })

  await test('取消全部候选：仅存记录，刷新后不复活任务', async ({ page, state }) => {
    await extract(page)
    for (const checkbox of await page.locator('.wf-task-review-card input[type="checkbox"]').all()) await checkbox.uncheck()
    await page.reload()
    await page.getByRole('heading', { name: '随记录创建任务（0项）', exact: true }).waitFor()
    await save(page, 0)
    assert.deepEqual(state.writes[1].body.task_candidates, [])
    assert.equal(state.tasks.length, 0)
  })

  await test('人工记录补充待办并保护老人切换', async ({ page, state }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await page.getByRole('button', { name: '直接填写', exact: true }).click()
    await field(page, 'raw_text').fill('张阿姨希望明天与女儿通话')
    await page.getByRole('button', { name: '补充一项待办', exact: true }).click()
    await page.getByLabel('第1项要做的事', { exact: true }).fill('安排通话')
    await field(page, 'elder_id').selectOption(otherElder.id)
    assert.equal(await page.locator('.wf-task-review-card').count(), 0)
    await field(page, 'elder_id').selectOption(elder.id)
    await page.getByRole('button', { name: '补充一项待办', exact: true }).click()
    await page.getByLabel('第1项要做的事', { exact: true }).fill('安排通话')
    await page.getByRole('button', { name: '本项由我负责', exact: true }).click()
    await page.getByLabel('第1项截止时间', { exact: true }).fill('2026-10-25T10:00')
    await save(page, 1)
    assert.equal(state.writes.length, 1); assert.equal(state.writes[0].path, '/records/manual')
  })

  await test('跨老人依据：未经核对不能创建到当前老人名下', async ({ page, state }) => {
    await extract(page)
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByText(/第1项待办：原文还提到其他老人/).waitFor()
    assert.equal(state.writes.length, 1)
    await page.getByLabel(/原文还提到了其他老人。我已核对/).check()
    await save(page, 1)
    assert.equal(state.tasks[0].elder_id, elder.id)
  }, { candidates: [{ ...source.task_candidates[0], object_review_required: true }] })
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify({ results, runtimeErrors: errors }, null, 2))
}
if (errors.length || results.some(row => !row.passed)) process.exitCode = 1

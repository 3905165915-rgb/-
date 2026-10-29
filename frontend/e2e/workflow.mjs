import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
// Retained record-form tests explicitly exercise the compatibility view.
// The current inline workflow is covered by inline-record-real.mjs.
const testFilter = process.env.WORKFLOW_TEST_FILTER || ''
const output = resolve('test-results/workflow')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'msedge',
})
const results = []
const errors = []
const elder = {
  id: 'ELDER-test',
  name: '虚构测试老人',
  bed_id: 'BED-test',
  status: 'active',
  revision: 1,
}
const staff = {
  id: 'USER-test',
  display_name: '虚构测试护理员',
  role: 'caregiver',
  enabled: true,
}
const shift = {
  id: 'SHIFT-test',
  name: '虚构跨夜班',
  start_at: '2026-10-23T20:00:00+08:00',
  end_at: '2026-10-24T08:00:00+08:00',
  status: 'open',
  caregiver_ids: [staff.id],
  revision: 1,
}
const record = {
  id: 'REC-test',
  elder_id: elder.id,
  raw_text: '虚构来源',
  observations: ['虚构观察'],
  revision: 1,
  status: 'confirmed',
  created_by: staff.id,
  created_at: '2026-10-23T00:00:00Z',
}
const task = {
  id: 'TASK-test',
  elder_id: elder.id,
  title: '虚构回访任务',
  status: 'pending',
  shift_id: shift.id,
  shift: shift.name,
  assigned_to: staff.id,
  due_at: '2026-10-24T06:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
  revision: 1,
  source_record_id: record.id,
  memory_references: [],
}
const draft = {
  id: 'AI-test',
  elder_id: elder.id,
  shift_id: shift.id,
  raw_text: '虚构：今天想休息',
  status: 'pending_review',
  observations: ['虚构：今天想休息'],
  task_candidates: [],
  evidence: [{ quote: '今天想休息' }],
  warnings: [],
  generation_kind: 'context_record',
  created_at: '2026-10-24T00:00:00Z',
  created_by: staff.id,
}
async function setup(role = 'caregiver') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const writes = []
  const requests = []
  const state = {
    failManual: false,
    failExport: false,
    failAI: 503,
    failHandoverAI: false,
    task: { ...task },
    draft: { ...draft },
    handover: null,
  }
  await context.addInitScript(
    ({ role }) => {
      if (!sessionStorage.getItem('hulao:session:v2'))
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'isolated-' + role,
            userId: 'USER-test',
            role,
            accessToken: 'synthetic-not-a-real-token',
          }),
        )
    },
    { role },
  )
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1', '')
    requests.push({ path, method: req.method() })
    const json = async (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      })
    if (req.method() !== 'GET') {
      writes.push({
        path,
        key: req.headers()['idempotency-key'],
        body: req.postDataJSON(),
      })
      if (path.includes('/reports/elders/') && state.failExport)
        return route.abort('failed')
      if (path === '/handovers') {
        state.handover = {
          id: 'HO-inline-test',
          source_shift_id: shift.id,
          target_shift_id: 'SHIFT-next',
          status: 'draft',
          revision: 1,
          items: [
            {
              id: 'HI-test',
              kind: 'task',
              elder_id: elder.id,
              source_id: task.id,
              detail: task.title,
            },
          ],
        }
        return json(state.handover, 201)
      }
      if (path === '/handovers/HO-inline-test/ai-summary') {
        if (state.failHandoverAI) return json({ detail: 'AI unavailable' }, 503)
        state.handover = {
          ...state.handover,
          revision: 2,
          ai_summary: {
            status: 'pending_review',
            text: '交班摘要：沿用未完成回访，明天下午询问活动意愿。',
            points: [
              {
                text: '明天下午询问活动意愿',
                citations: [{ quote: '明天下午三点询问是否愿意听戏' }],
              },
            ],
          },
          handover_suggestions: [
            {
              id: 'HSUG-test',
              title: '询问活动意愿',
              evidence_text: '明天下午三点询问是否愿意听戏',
              condition: null,
              due_text: '明天下午三点',
            },
          ],
        }
        return json(state.handover)
      }
      if (path === '/handovers/HO-inline-test/refresh') {
        state.handover = {
          ...state.handover,
          revision: state.handover.revision + 1,
          ai_summary: null,
          handover_suggestions: [],
        }
        return json(state.handover)
      }
      if (path === '/handovers/HO-inline-test/submit') {
        state.handover = {
          ...state.handover,
          ...req.postDataJSON(),
          status: 'submitted',
          revision: 3,
        }
        return json(state.handover)
      }
      if (path === '/quality/checks')
        return json(
          { id: 'QC-test', issues: [], scope: req.postDataJSON() },
          201,
        )
      if (path === '/tasks')
        return json({ ...state.task, ...req.postDataJSON() }, 201)
      if (path === '/records/manual') {
        if (state.failManual) {
          state.failManual = false
          return route.abort('failed')
        }
        return json(
          {
            record: { ...record, raw_text: req.postDataJSON().raw_text },
            tasks: [state.task],
          },
          201,
        )
      }
      if (/\/records\/(context-)?extract$/.test(path)) {
        if (state.failAI === 'network') return route.abort('failed')
        if (state.failAI === 200) {
          state.draft.raw_text = req.postDataJSON().text
          return json(state.draft)
        }
        return json(
          { detail: 'AI provider unavailable; use manual entry' },
          503,
        )
      }
      if (path === '/records/AI-test/confirm') {
        state.draft.status = 'confirmed'
        return json({ record, tasks: [] }, 201)
      }
      return json(state.task)
    }
    if (path === '/elders') return json([elder])
    if (path === '/tasks') return json([state.task])
    if (path === '/tasks/TASK-test') return json(state.task)
    if (path === '/shifts')
      return json([
        shift,
        {
          ...shift,
          id: 'SHIFT-next',
          name: '虚构接班',
          start_at: '2099-10-28T08:00:00+08:00',
          end_at: '2099-10-28T20:00:00+08:00',
          caregiver_ids: [staff.id],
        },
        {
          ...shift,
          id: 'SHIFT-closed',
          name: '历史已关闭班',
          status: 'closed',
        },
      ])
    if (path === '/handovers/HO-inline-test')
      return json(state.handover || { id: 'HO-inline-test', status: 'draft' })
    if (
      path === '/handovers' &&
      new URL(req.url()).searchParams.has('shift_id')
    )
      return json(state.handover ? [state.handover] : [])
    if (path === '/handovers')
      return json([
        {
          id: 'HO-test',
          source_shift_id: 'SHIFT-closed',
          target_shift_id: shift.id,
          status: 'draft',
          items: [],
        },
        {
          id: 'HO-other',
          source_shift_id: shift.id,
          target_shift_id: 'SHIFT-next',
          status: 'draft',
          items: [],
        },
      ])
    if (path === '/reports/metrics') return json({ note: '统计刷新成功' })
    if (path === '/staff' || path === '/staff/directory') return json([staff])
    if (path === '/records') return json([record])
    if (path === '/records/drafts') return json([state.draft])
    if (path === '/records/drafts/AI-test') return json(state.draft)
    if (path === '/records/REC-test') return json(record)
    if (path === '/memories/context')
      return json({ elder_id: elder.id, scene: 'communication', memories: [] })
    if (path.startsWith('/family/me/')) return json([])
    return json([])
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { context, page, writes, requests, state }
}
const field = (page, key) =>
  page
    .locator(`[data-field="填写办理内容.${key}"]`)
    .locator('input,textarea,select')
    .first()
async function menuButton(page, name) {
  const desktop = page.locator('.wf-desktop-menu')
  if (await desktop.isVisible())
    return desktop.getByRole('button', { name, exact: true })
  const dialog = page.getByRole('dialog', { name: '功能菜单', exact: true })
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: '☰ 功能菜单', exact: true }).click()
  return dialog.getByRole('button', { name, exact: true })
}
async function navigateMenu(page, name) {
  await (await menuButton(page, name)).click()
}
async function submit(page) {
  await page.getByRole('button', { name: '核对并继续', exact: true }).click()
  await page
    .getByRole('button', {
      name: /^(确认提交|仅保存记录|保存记录并创建\d+项任务)$/,
    })
    .click()
}
async function test(name, fn, role = 'caregiver') {
  if (testFilter && !name.includes(testFilter)) return
  const env = await setup(role)
  try {
    await fn(env)
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (e) {
    results.push({
      name,
      passed: false,
      error: String(e.stack),
      body: await env.page.locator('body').innerText(),
    })
    await env.page.screenshot({
      path: resolve(output, `failure-${results.length}.png`),
      fullPage: true,
    })
    console.error('FAIL ' + name + ': ' + e.message)
  } finally {
    await env.context.close()
  }
}
try {
  await test('新建任务：最后输入刷新恢复、人工字段与来源、单次提交和回执恢复', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/tasks/new?elder=ELDER-test')
    await field(page, 'condition').fill('虚构：本人愿意沟通，最后输入')
    await page.reload()
    await field(page, 'condition').waitFor()
    assert.equal(
      await field(page, 'condition').inputValue(),
      '虚构：本人愿意沟通，最后输入',
    )
    await field(page, 'shift_id').selectOption(shift.id)
    await field(page, 'title').fill('虚构回访任务')
    await field(page, 'assigned_to').selectOption('USER-test')
    await field(page, 'due_at').fill('2099-10-24T14:00')
    await field(page, 'completion_criteria').fill('虚构：回访并记录本人反馈')
    await submit(page)
    await page
      .getByText('任务已创建，服务器已确认；请在任务列表继续核验执行条件。', {
        exact: true,
      })
      .waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].path, '/tasks')
    assert.equal(writes[0].body.elder_id, elder.id)
    assert.equal(writes[0].body.completion_criteria, '虚构：回访并记录本人反馈')
    assert.equal(writes[0].body.condition, '虚构：本人愿意沟通，最后输入')
    assert.equal(writes[0].body.source_type, 'manual')
    assert.equal(writes[0].body.raw_text, undefined)
    assert.ok(writes[0].key)
    await page.reload()
    assert.equal(
      await page
        .getByRole('button', { name: '本次操作已完成', exact: true })
        .isDisabled(),
      true,
    )
    assert.equal(writes.length, 1)
  })
  await test('未知提交：刷新后复用原请求编号及原文，不重复创建', async ({
    page,
    writes,
    state,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat')
    await page.getByRole('button', { name: '直接填写', exact: true }).click()
    await field(page, 'elder_id').selectOption(elder.id)
    await field(page, 'raw_text').fill('虚构：结果未知，不能重建')
    state.failManual = true
    await submit(page)
    await page
      .getByRole('button', { name: '使用原请求核实结果', exact: true })
      .waitFor()
    await page.reload()
    assert.equal(await field(page, 'raw_text').isDisabled(), true)
    await page
      .getByRole('button', { name: '使用原请求核实结果', exact: true })
      .click()
    await page
      .getByRole('button', { name: '使用原请求核实结果', exact: true })
      .click()
    await page
      .getByText('记录已保存，同时创建了1项任务。可在任务列表按老人查看。', {
        exact: true,
      })
      .waitFor()
    assert.equal(writes.length, 2)
    assert.equal(writes[0].key, writes[1].key)
    assert.deepEqual(writes[0].body, writes[1].body)
  })
  await test('AI503：原文不丢失，人工模式不继承AI猜测', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat&elder=ELDER-test')
    await field(page, 'scene').selectOption('communication')
    await field(page, 'text').fill('明天再看看')
    await submit(page)
    await page.getByText(/AI暂不可用/).waitFor()
    await page.getByRole('button', { name: '直接填写', exact: true }).click()
    assert.equal(await field(page, 'raw_text').inputValue(), '明天再看看')
    assert.equal(await field(page, 'elder_id').inputValue(), elder.id)
    assert.equal(
      await page
        .locator('[data-field="填写办理内容.task_candidates.0"]')
        .count(),
      0,
    )
    assert.equal(writes.length, 1)
  })
  await test('AI连接中断：保留未核实请求后可人工录入，不自动确认草稿', async ({
    page,
    state,
    writes,
  }) => {
    state.failAI = 'network'
    await page.goto(base + '/mobile/records/new?action=compat&elder=ELDER-test')
    await field(page, 'scene').selectOption('rest')
    await field(page, 'text').fill('今天想休息，明天下午再问我')
    await submit(page)
    const fallback = page.getByRole('button', {
      name: '保留待核实AI请求并转人工',
      exact: true,
    })
    await fallback.waitFor()
    page.once('dialog', (d) => d.accept())
    await fallback.click()
    assert.equal(
      await field(page, 'raw_text').inputValue(),
      '今天想休息，明天下午再问我',
    )
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) => k.includes(':unresolved-ai:'))
            .length,
      ),
      1,
    )
    assert.equal(writes.length, 1)
  })
  await test('多窗口版本冲突：旧表单禁止提交并保留独立恢复日志', async ({
    page,
    context,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat&elder=ELDER-test')
    await field(page, 'text').fill('窗口甲原文')
    const other = await context.newPage()
    await other.goto(
      base + '/mobile/records/new?action=compat&elder=ELDER-test',
    )
    await field(other, 'text').fill('窗口乙新原文')
    await page
      .getByText(/其他窗口已修改此表单/)
      .first()
      .waitFor()
    await field(page, 'text').fill('窗口甲未覆盖的最后输入')
    assert.equal(
      await page
        .getByRole('button', { name: '核对并继续', exact: true })
        .isDisabled(),
      true,
    )
    assert.ok(
      await page.evaluate(() =>
        Object.entries(localStorage).some(
          ([key, value]) =>
            key.includes(':writer:') &&
            value.includes('窗口甲未覆盖的最后输入'),
        ),
      ),
    )
  })
  await test('记录入口合并：模式切换保留原文，列表往返可恢复输入', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat&elder=ELDER-test')
    for (const name of [
      'AI原文提取',
      '情境AI助手',
      '新建人工记录',
      '查看正式记录',
      '记录更正历史',
    ])
      assert.equal(
        await page.getByRole('button', { name, exact: true }).count(),
        0,
      )
    await field(page, 'text').fill('今天想休息，晚些再问本人')
    await page.getByRole('button', { name: '直接填写', exact: true }).click()
    assert.equal(
      await field(page, 'raw_text').inputValue(),
      '今天想休息，晚些再问本人',
    )
    await field(page, 'raw_text').fill('保留最后一句人工补充')
    await page.getByRole('button', { name: '整理后核对', exact: true }).click()
    assert.equal(await field(page, 'text').inputValue(), '保留最后一句人工补充')
    assert.equal(await field(page, 'elder_id').inputValue(), elder.id)
    await navigateMenu(page, '历史')
    await navigateMenu(page, '写记录')
    assert.equal(await field(page, 'text').inputValue(), '保留最后一句人工补充')
    assert.equal(writes.length, 0)
  })
  await test('统一整理链路：只走上下文整理，人工核对后才保存正式记录', async ({
    page,
    writes,
    state,
  }) => {
    state.failAI = 200
    await page.goto(base + '/mobile/records/new?action=compat&elder=ELDER-test')
    await field(page, 'scene').selectOption('rest')
    await field(page, 'text').fill('虚构：今天想休息')
    await submit(page)
    await page
      .getByText('整理完成，请核对结果；正式记录尚未保存。', { exact: true })
      .waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].path, '/records/context-extract')
    await page
      .getByRole('button', { name: '核对并保存记录', exact: true })
      .click()
    await page.getByText('查看原文与整理依据', { exact: true }).waitFor()
    assert.equal(writes.length, 1)
    assert.equal(
      await page.locator('[data-field="draft_id"] select').inputValue(),
      draft.id,
    )
    await submit(page)
    await page
      .getByText(/^(已保存，服务器已确认成功。|记录已保存，本次未创建任务。)$/)
      .waitFor()
    assert.deepEqual(
      writes.map((row) => row.path),
      ['/records/context-extract', '/records/AI-test/confirm'],
    )
  })
  await test('记录详情与历史同处一页，更正通过当前记录上下文进入', async ({
    page,
    requests,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat')
    await navigateMenu(page, '历史')
    await page
      .getByRole('button', { name: '读取当前数据', exact: true })
      .click()
    await page.locator('.wf-results .wf-select-row').first().click()
    await page.getByText('更正历史', { exact: true }).waitFor()
    assert.ok(requests.some((row) => row.path === '/records/REC-test/history'))
    await page.getByRole('button', { name: '追加更正', exact: true }).click()
    assert.equal(
      await page.locator('[data-field="record_id"] select').inputValue(),
      record.id,
    )
    assert.equal(await field(page, 'expected_revision').inputValue(), '1')
    await page
      .getByRole('button', { name: '返回记录列表', exact: true })
      .click()
    await navigateMenu(page, '写记录')
    await field(page, 'scene').waitFor()
    assert.equal(await page.locator('[data-field="record_id"]').count(), 0)
  })
  await test('护理员单页交班：原待办沿用，分析失败保留输入，确认新待办后只提交一次', async ({
    page,
    writes,
    state,
  }) => {
    await page.goto(base + '/mobile/handover')
    await page.getByText('虚构回访任务', { exact: true }).waitFor()
    const note = page.getByLabel('交班内容', { exact: true })
    await note.fill('明天下午三点询问是否愿意听戏')
    state.failHandoverAI = true
    await page.getByRole('button', { name: '分析并核对', exact: true }).click()
    await page.getByText(/交班内容已保留；分析未完成/).waitFor()
    assert.equal(await note.inputValue(), '明天下午三点询问是否愿意听戏')
    assert.equal(writes.filter((row) => row.path.endsWith('/submit')).length, 0)
    await page.reload()
    await page.getByLabel('交班内容', { exact: true }).waitFor()
    assert.equal(
      await page.getByLabel('交班内容', { exact: true }).inputValue(),
      '明天下午三点询问是否愿意听戏',
    )
    assert.equal(writes.filter((row) => row.path === '/handovers').length, 1)
    state.failHandoverAI = false
    await page.getByRole('button', { name: '分析并核对', exact: true }).click()
    assert.equal(
      await page.getByLabel('摘要').inputValue(),
      '交班摘要：沿用未完成回访，明天下午询问活动意愿。',
    )
    await page.getByRole('checkbox', { name: '采纳新待办' }).check()
    await page.getByLabel('老人').selectOption(elder.id)
    await page.getByLabel('责任人').selectOption(staff.id)
    await page.getByLabel('截止时间').fill('2099-10-28T14:00')
    await page.getByLabel('完成标准').fill('询问本人并记录选择')
    await page
      .getByRole('button', { name: '核对并提交交班', exact: false })
      .click()
    await page
      .getByText('交班已提交，已有未完成任务沿用原编号接续。', { exact: true })
      .waitFor()
    assert.deepEqual(
      writes
        .filter((row) => row.path.endsWith('/submit'))
        .map((row) => row.body.accepted_tasks),
      [
        [
          {
            suggestion_id: 'HSUG-test',
            elder_id: elder.id,
            title: '询问活动意愿',
            shift_id: 'SHIFT-next',
            assigned_to: staff.id,
            due_at: '2099-10-28T14:00:00+08:00',
            completion_criteria: '询问本人并记录选择',
          },
        ],
      ],
    )
    assert.equal(writes.filter((row) => row.path.endsWith('/submit')).length, 1)
    assert.ok(writes.some((row) => row.path.endsWith('/ai-summary')))
  })
  await test('草稿统一入口：列表选择后继续核对，不恢复成旧的新增操作', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/records/new?action=compat')
    await field(page, 'text').fill('未提交的新增内容')
    await navigateMenu(page, '草稿')
    await page
      .getByRole('button', { name: '读取当前数据', exact: true })
      .click()
    await page.locator('.wf-results .wf-select-row').first().click()
    await page
      .getByRole('button', { name: '核对并保存记录', exact: true })
      .click()
    assert.equal(
      await page.locator('[data-field="draft_id"] select').inputValue(),
      draft.id,
    )
    await submit(page)
    await page
      .getByText(/^(已保存，服务器已确认成功。|记录已保存，本次未创建任务。)$/)
      .waitFor()
    assert.deepEqual(
      writes.map((row) => row.path),
      ['/records/AI-test/confirm'],
    )
  })
  await test('旧原文提取的未知请求仍可恢复，不能通过合并入口重复保存', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      const key =
        'hulao:workflow:v2:' +
        JSON.stringify(['isolated-caregiver', 'records', { action: 'compat' }])
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            operation: 'extract_api_v1_records_extract_post',
            params: {},
            body: { elder_id: 'ELDER-test', text: '旧版本未核实原文' },
            phase: 'pending',
            pending: {
              signature: 'legacy-signature',
              key: 'legacy-request',
              path: '/records/extract',
              method: 'post',
              payload: { elder_id: 'ELDER-test', text: '旧版本未核实原文' },
              retryable: false,
            },
            updatedAt: new Date().toISOString(),
          }),
        )
    })
    await page.goto(base + '/mobile/records/new?action=compat')
    await page.getByText(/本次写入结果待核实/).waitFor()
    assert.equal(await field(page, 'text').inputValue(), '旧版本未核实原文')
    assert.equal(
      await page
        .getByRole('button', { name: '直接填写', exact: true })
        .isDisabled(),
      true,
    )
    await page.reload()
    await page.getByText(/本次写入结果待核实/).waitFor()
    assert.equal(
      await page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          value.includes('legacy-request'),
        ),
      ),
      true,
    )
  })
  await test(
    '多窗口统计查询：不创建共享草稿，不阻塞刷新，保留导出编辑稿',
    async ({ page, context, writes }) => {
      await page.goto(
        base +
          '/admin/workflows/reports?action=%2Freports%2Fmetrics&read=1&start=2026-10-25&end=2026-10-26',
      )
      await page.getByText('统计刷新成功', { exact: true }).waitFor()
      assert.equal(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((k) =>
              k.startsWith('hulao:workflow:v2:'),
            ).length,
        ),
        0,
      )
      const other = await context.newPage()
      await other.goto(
        base +
          '/admin/workflows/reports?action=%2Freports%2Fmetrics&read=1&start=2026-10-25&end=2026-10-26',
      )
      await other.getByText('统计刷新成功', { exact: true }).waitFor()
      await navigateMenu(page, '证据导出')
      await field(page, 'reason').fill('保留本窗口导出原因')
      const before = await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([k]) =>
            k.startsWith('hulao:workflow:v2:'),
          ),
        ),
      )
      await other.locator('[data-field="start"] input').fill('2026-10-20')
      await other
        .getByRole('button', { name: '读取当前数据', exact: true })
        .click()
      await other.getByText('已读取服务器当前数据。', { exact: true }).waitFor()
      assert.equal(
        await other.getByText(/其他窗口已修改此表单|本机保存未完成/).count(),
        0,
      )
      assert.equal(
        await page.getByText(/其他窗口已修改此表单|本机保存未完成/).count(),
        0,
      )
      assert.deepEqual(
        await page.evaluate(() =>
          Object.fromEntries(
            Object.entries(localStorage).filter(([k]) =>
              k.startsWith('hulao:workflow:v2:'),
            ),
          ),
        ),
        before,
      )
      await navigateMenu(page, '运营统计')
      await page.reload()
      await page.getByText('统计刷新成功', { exact: true }).waitFor()
      await navigateMenu(page, '证据导出')
      assert.equal(
        await field(page, 'reason').inputValue(),
        '保留本窗口导出原因',
      )
      assert.equal(writes.length, 0)
    },
    'admin',
  )
  await test(
    '旧统计草稿与存储事件：查询不报冲突也不覆盖旧日志',
    async ({ page, context }) => {
      await page.goto(
        base +
          '/admin/workflows/reports?action=%2Freports%2Fmetrics&read=1&start=2026-10-25&end=2026-10-26',
      )
      await page.getByText('统计刷新成功', { exact: true }).waitFor()
      const key = await page.evaluate(() => {
        const start = document.querySelector('[data-field="start"] input').value
        const end = document.querySelector('[data-field="end"] input').value
        const key =
          'hulao:workflow:v2:' +
          JSON.stringify([
            'isolated-admin',
            'reports',
            { action: '/reports/metrics', end, read: '1', start },
          ])
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 8,
            operation: 'metrics_api_v1_reports_metrics_get',
            params: { start, end },
            body: {},
            phase: 'editing',
            updatedAt: new Date().toISOString(),
          }),
        )
        return key
      })
      await page.reload()
      await page.getByText('统计刷新成功', { exact: true }).waitFor()
      const other = await context.newPage()
      await other.goto(
        base +
          '/admin/workflows/reports?action=%2Freports%2Fmetrics&read=1&start=2026-10-25&end=2026-10-26',
      )
      await other.evaluate((key) => {
        const value = JSON.parse(localStorage.getItem(key))
        value.version++
        localStorage.setItem(key, JSON.stringify(value))
      }, key)
      await page
        .getByRole('button', { name: '读取当前数据', exact: true })
        .click()
      assert.equal(
        await page.getByText(/其他窗口已修改此表单|本机保存未完成/).count(),
        0,
      )
      assert.equal(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).version,
          key,
        ),
        9,
      )
    },
    'admin',
  )
  await test(
    '未核实的写入：切换到查询和刷新仍无法绕过保护',
    async ({ page, writes, state }) => {
      await page.goto(
        base +
          '/admin/workflows/reports?action=%2Freports%2Fmetrics&read=1&start=2026-10-25&end=2026-10-26',
      )
      await navigateMenu(page, '证据导出')
      await page
        .locator('[data-field="elder_id"] select')
        .selectOption(elder.id)
      await field(page, 'reason').fill('虚构导出验证')
      state.failExport = true
      await submit(page)
      await page.getByText(/本次写入结果待核实/).waitFor()
      assert.equal(
        await (await menuButton(page, '运营统计')).isDisabled(),
        true,
      )
      await page.reload()
      await page.getByText(/本次写入结果待核实/).waitFor()
      assert.equal(
        await (await menuButton(page, '运营统计')).isDisabled(),
        true,
      )
      assert.equal(writes.length, 1)
    },
    'admin',
  )
  await test(
    '质检范围：交出班次联动、历史班次可选、不匹配交班单自动清除',
    async ({ page, writes }) => {
      await page.goto(base + '/admin/quality')
      await field(page, 'handover_id').selectOption('HO-test')
      assert.equal(await field(page, 'shift_id').inputValue(), 'SHIFT-closed')
      await field(page, 'shift_id').selectOption(shift.id)
      assert.equal(await field(page, 'handover_id').inputValue(), '')
      assert.deepEqual(
        await field(page, 'handover_id')
          .locator('option')
          .evaluateAll((rows) => rows.slice(1).map((row) => row.value)),
        ['HO-other'],
      )
      await field(page, 'shift_id').selectOption('')
      await field(page, 'handover_id').selectOption('HO-test')
      await submit(page)
      await page
        .getByText('检查完成，请由主管核对；未自动判定责任或修改任务。', {
          exact: true,
        })
        .waitFor()
      assert.equal(writes.length, 1)
      assert.equal(writes[0].body.shift_id, 'SHIFT-closed')
      assert.equal(writes[0].body.handover_id, 'HO-test')
    },
    'admin',
  )
  await test('手机与桌面尺寸：核心表单无横向溢出', async ({ page }) => {
    for (const width of [320, 375, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(base + '/mobile/tasks/new?elder=ELDER-test')
      await field(page, 'title').waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `mobile ${width}`,
      )
      await page.screenshot({
        path: resolve(output, `mobile-${width}.png`),
        fullPage: true,
      })
    }
  })
  await test(
    '管理端核心表单在平板与桌面尺寸无横向溢出',
    async ({ page }) => {
      for (const width of [768, 1366]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(base + '/admin/tasks?create=1&elder=ELDER-test')
        await field(page, 'title').waitFor()
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          `admin ${width}`,
        )
        await page.screenshot({
          path: resolve(output, `admin-${width}.png`),
          fullPage: true,
        })
      }
    },
    'admin',
  )
  await test(
    '记录菜单适配：电脑侧栏、手机抽屉、键盘关闭及窄屏无溢出',
    async ({ page }) => {
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(base + '/admin/workflows/records?action=compat')
        await page.waitForLoadState('networkidle')
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          'record width ' + width,
        )
        assert.equal(await page.locator('.wf-actions').count(), 0)
        if (width <= 1100) {
          await page
            .getByRole('button', { name: '☰ 功能菜单', exact: true })
            .click()
          const dialog = page.getByRole('dialog', {
            name: '功能菜单',
            exact: true,
          })
          assert.equal(await dialog.isVisible(), true)
          if (width === 390)
            await page.screenshot({
              path: resolve(output, 'records-mobile-menu.png'),
              fullPage: true,
            })
          await page.keyboard.press('Escape')
          assert.equal(await dialog.isVisible(), false)
          assert.equal(
            await page
              .getByRole('button', { name: '☰ 功能菜单', exact: true })
              .evaluate((node) => node === document.activeElement),
            true,
          )
        } else {
          assert.equal(await page.locator('.wf-desktop-menu').isVisible(), true)
          await page.screenshot({
            path: resolve(output, 'records-desktop.png'),
            fullPage: true,
          })
        }
      }
    },
    'admin',
  )
  const family = await setup('family')
  try {
    await family.page.goto(base + '/mobile/tasks/new')
    await family.page.waitForURL('**/mobile/family')
    await family.page.getByRole('heading', { name: '今天想看看谁？' }).waitFor()
    assert.equal(
      family.requests.filter(
        (request) => !request.path.startsWith('/family/me/'),
      ).length,
      0,
    )
    results.push({
      name: '家属拒绝内部新建任务入口且不发内部请求',
      passed: true,
    })
  } finally {
    await family.context.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ results, runtimeErrors: errors }, null, 2),
  )
}
if (results.some((r) => !r.passed) || errors.length) process.exitCode = 1

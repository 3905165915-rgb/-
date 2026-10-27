import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5217'
const output = 'test-results/merge-regression'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'msedge',
})
const results = [],
  errors = []
const elder = {
  id: 'ELDER-merge',
  name: '虚构回归老人',
  bed_id: 'BED-merge',
  bed_label: '101床',
  status: 'active',
  current_admission_id: 'ADM-merge',
  revision: 1,
}
const staff = {
  id: 'STAFF-merge',
  display_name: '虚构回归人员',
  role: 'caregiver',
  enabled: true,
}
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const shift = {
  id: 'SHIFT-merge',
  name: '虚构回归班次',
  start_at: day + 'T00:00:00+08:00',
  end_at: day + 'T23:59:00+08:00',
  status: 'open',
  caregiver_ids: [staff.id],
  revision: 1,
}
const initialTask = {
  id: 'TASK-merge',
  elder_id: elder.id,
  elder_name: elder.name,
  bed_label: elder.bed_label,
  title: '询问本次活动意愿',
  status: 'pending',
  assigned_to: staff.id,
  assignee_name: staff.display_name,
  shift_id: shift.id,
  shift_name: shift.name,
  due_at: new Date(Date.now() + 3600000).toISOString(),
  updated_at: new Date().toISOString(),
  revision: 1,
  memory_references: [],
  allowed_actions: ['start', 'not_done'],
}
async function open(handler, role = 'admin') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  await context.addInitScript(
    ({ role }) => {
      if (!sessionStorage.getItem('hulao:session:v2'))
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'isolated-merge-' + role,
            userId: 'STAFF-merge',
            role,
            accessToken: 'synthetic-test-only',
          }),
        )
    },
    { role },
  )
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/v1', '')
    const respond = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      })
    if (await handler({ path, req, respond })) return
    if (path === '/elders') return respond([elder])
    if (path === '/staff') return respond([staff])
    if (path === '/shifts') return respond([shift])
    if (path === '/tasks') return respond([initialTask])
    return respond([], req.method() === 'GET' ? 200 : 405)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => errors.push(e.message))
  return { page, context }
}
async function test(name, run) {
  try {
    await run()
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, passed: false, error: error.message })
    console.error('FAIL ' + name + ': ' + error.message)
  }
}
try {
  await test('后台整理：保存后刷新接续同记录，完成后不重复原文提交', async () => {
    let saves = 0,
      reads = 0
    const record = {
      id: 'REC-merge',
      elder_id: elder.id,
      raw_text: '虚构回归：今天想安静休息。',
      status: 'confirmed',
      revision: 1,
      admission_id: 'ADM-merge',
      created_at: new Date().toISOString(),
      happened_at: null,
    }
    const { page, context } = await open(async ({ path, req, respond }) => {
      if (path === `/elders/${elder.id}/record`) {
        saves++
        assert.equal(req.postDataJSON().background, true)
        await respond({ record, analysis_status: 'queued', analysis: null })
        return true
      }
      if (path === `/elders/${elder.id}/records/${record.id}/analysis`) {
        reads++
        await respond(
          reads === 1
            ? { record, analysis_status: 'processing', analysis: null }
            : {
                record,
                analysis_status: 'ready',
                analysis: {
                  id: 'AN-merge',
                  record_id: record.id,
                  record_revision: 1,
                  status: 'ready',
                  scene: { value: null, citation: null },
                  observations: [],
                  task_suggestions: [],
                  preference_suggestions: [],
                  created_at: record.created_at,
                },
              },
        )
        return true
      }
      return false
    }, 'caregiver')
    try {
      await page.goto(base + '/mobile/records/new?elder=' + elder.id)
      await page.getByLabel('本次记录', { exact: true }).fill(record.raw_text)
      await page.getByRole('button', { name: '保存记录', exact: true }).click()
      await page
        .getByText('记录已保存，正在后台整理。你可以继续工作。', {
          exact: true,
        })
        .waitFor()
      await page.reload()
      await page
        .locator('.workspace-badge')
        .filter({ hasText: '待核对' })
        .waitFor()
      assert.equal(saves, 1)
      assert.ok(reads >= 2)
      await page.reload()
      await page.getByText('已恢复上次服务器回执', { exact: false }).waitFor()
      assert.equal(saves, 1)
    } finally {
      await context.close()
    }
  })
  await test('三步安排：立即刷新保留输入，未知提交刷新后复用原请求', async () => {
    const writes = []
    const { page, context } = await open(async ({ path, req, respond }) => {
      if (path === `/elders/${elder.id}/arrangement`) {
        await respond({
          elder,
          assessment: { id: 'AS-merge', status: 'valid' },
          needs_assessment: false,
          previous_plan: null,
          shifts: [shift],
          staff: [staff],
          memories: [],
        })
        return true
      }
      if (path.endsWith('/arrangement/preview')) {
        await respond({
          context_token: 'synthetic-reviewed-context',
          items: [
            {
              title: req.postDataJSON().items[0].title,
              scheduled_at: new Date(Date.now() + 1800000).toISOString(),
              due_at: initialTask.due_at,
              completion_criteria: '询问并登记实际回应',
            },
          ],
          unassigned_items: [],
          affected_task_ids: [],
          existing_task_count: 0,
        })
        return true
      }
      if (path.endsWith('/arrangement/confirm')) {
        writes.push({
          key: req.headers()['idempotency-key'],
          body: req.postDataJSON(),
        })
        await respond(
          writes.length === 1
            ? {}
            : {
                plan: { id: 'PLAN-merge', elder_id: elder.id },
                created_tasks: [{ id: 'NEW-merge' }],
                notice: '合成回执：已保存',
              },
          writes.length === 1 ? 500 : 200,
        )
        return true
      }
      return false
    })
    try {
      await page.goto(base + '/admin/care-plan?elder=' + elder.id)
      const region = page.getByRole('region', {
        name: '三步照护安排',
        exact: true,
      })
      await region
        .getByRole('button', { name: '下一步：安排服务', exact: true })
        .click()
      await region
        .getByLabel('服务内容', { exact: true })
        .fill('虚构：先询问本人再安排活动')
      await region
        .getByLabel('怎样完成', { exact: true })
        .fill('保留刷新前最后一句')
      await page.reload()
      await region
        .getByRole('button', { name: '下一步：安排服务', exact: true })
        .click()
      assert.equal(
        await region.getByLabel('怎样完成', { exact: true }).inputValue(),
        '保留刷新前最后一句',
      )
      assert.equal(
        await region.getByLabel('服务内容', { exact: true }).inputValue(),
        '虚构：先询问本人再安排活动',
      )
      await region
        .getByRole('combobox', { name: '今日班次', exact: true })
        .selectOption(shift.id)
      await region
        .getByRole('combobox', { name: '负责人', exact: true })
        .selectOption(staff.id)
      await region
        .getByRole('button', { name: '预览安排', exact: true })
        .click()
      await region
        .getByRole('button', { name: '确认安排', exact: true })
        .click()
      await region
        .getByRole('button', { name: '核实上次安排', exact: true })
        .waitFor()
      await page.reload()
      await region
        .getByRole('button', { name: '核实上次安排', exact: true })
        .click()
      await region
        .getByRole('heading', { name: '安排已保存', exact: true })
        .waitFor()
      assert.equal(writes.length, 2)
      assert.ok(writes[0].key)
      assert.deepEqual(writes[0], writes[1])
    } finally {
      await context.close()
    }
  })
  await test('任务办理：开始、结果恢复、原请求核实及终态操作保护', async () => {
    let task = structuredClone(initialTask)
    const writes = []
    const { page, context } = await open(async ({ path, req, respond }) => {
      if (path === '/tasks/' + task.id) {
        await respond(task)
        return true
      }
      if (path === `/tasks/${task.id}/transition`) {
        assert.equal(req.postDataJSON().action, 'start')
        task = {
          ...task,
          status: 'in_progress',
          revision: 2,
          allowed_actions: ['complete', 'not_done'],
        }
        await respond(task)
        return true
      }
      if (path === `/tasks/${task.id}/complete`) {
        writes.push({
          key: req.headers()['idempotency-key'],
          body: req.postDataJSON(),
        })
        if (writes.length === 1) await respond({}, 500)
        else {
          task = {
            ...task,
            status: 'completed',
            revision: 3,
            result: req.postDataJSON().result,
            allowed_actions: ['start', 'complete', 'not_done'],
          }
          await respond(task)
        }
        return true
      }
      return false
    }, 'caregiver')
    try {
      await page.goto(base + '/mobile/tasks/' + task.id)
      const region = page.getByRole('region', {
        name: '办理当前任务',
        exact: true,
      })
      await region
        .getByRole('button', { name: '开始服务', exact: true })
        .click()
      await region
        .getByLabel('服务结果', { exact: true })
        .fill('虚构：已询问，本人选择休息。最后输入')
      await page.reload()
      assert.equal(
        await region.getByLabel('服务结果', { exact: true }).inputValue(),
        '虚构：已询问，本人选择休息。最后输入',
      )
      await region
        .getByRole('button', { name: '提交服务结果', exact: true })
        .click()
      await region
        .getByRole('button', { name: '核实上次提交', exact: true })
        .waitFor()
      assert.equal(
        await region.getByLabel('服务结果', { exact: true }).isDisabled(),
        true,
      )
      await page.reload()
      await region
        .getByRole('button', { name: '核实上次提交', exact: true })
        .click()
      await region
        .getByText('办理结果：虚构：已询问，本人选择休息。最后输入', {
          exact: true,
        })
        .waitFor()
      assert.equal(writes.length, 2)
      assert.ok(writes[0].key)
      assert.deepEqual(writes[0], writes[1])
      assert.equal(
        await region
          .getByRole('button', { name: /^(开始服务|提交服务结果|本次未执行)$/ })
          .count(),
        0,
      )
    } finally {
      await context.close()
    }
  })
  await test('任务仅允许未执行时仍可填写原因并提交', async () => {
    let task = { ...initialTask, allowed_actions: ['not_done'] }
    const writes = []
    const { page, context } = await open(async ({ path, req, respond }) => {
      if (path === '/tasks/' + task.id) {
        await respond(task)
        return true
      }
      if (path === '/tasks/' + task.id + '/transition') {
        const body = req.postDataJSON()
        writes.push(body)
        assert.equal(body.action, 'not_done')
        assert.equal(body.reason_code, 'elder_refused')
        task = {
          ...task,
          status: 'not_done',
          revision: 2,
          allowed_actions: [],
          result: body.note,
        }
        await respond(task)
        return true
      }
      return false
    }, 'caregiver')
    try {
      await page.goto(base + '/mobile/tasks/' + task.id)
      const region = page.getByRole('region', {
        name: '办理当前任务',
        exact: true,
      })
      await region
        .getByRole('button', { name: '本次未执行', exact: true })
        .click()
      await region
        .getByLabel('未执行说明', { exact: true })
        .fill('虚构：本人表示本次不参加。')
      await region
        .getByRole('combobox', { name: /^未执行原因/ })
        .selectOption('elder_refused')
      await region
        .getByRole('button', { name: '登记未执行', exact: true })
        .click()
      await region
        .getByText('办理结果：虚构：本人表示本次不参加。', { exact: true })
        .waitFor()
      assert.equal(writes.length, 1)
    } finally {
      await context.close()
    }
  })
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(
    output + '/results.json',
    JSON.stringify({ results, errors }, null, 2),
  )
}
if (results.some((row) => !row.passed) || errors.length) process.exitCode = 1

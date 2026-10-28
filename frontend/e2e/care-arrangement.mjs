import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// These are frontend contract tests, not evidence of a deployed backend.
const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5217'
const output = 'test-results/care-arrangement'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
})
const results = [],
  runtimeErrors = []
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const elder = {
  id: 'E-synthetic-care',
  name: '虚构照护老人',
  status: 'active',
  bed_label: '虚构101床',
  bed_id: 'B-synthetic',
  current_admission_id: 'A-synthetic',
  revision: 1,
}
const staff = {
  id: 'U-synthetic-care',
  display_name: '虚构工作人员',
  role: 'caregiver',
  enabled: true,
}
const shift = {
  id: 'S-synthetic-care',
  name: '虚构班次',
  start_at: day + 'T00:00:00+08:00',
  end_at: day + 'T23:59:59+08:00',
  caregiver_ids: [staff.id],
  status: 'open',
  revision: 1,
}
const hint = {
  id: 'H-synthetic-care',
  elder_id: elder.id,
  title: '沟通时放慢语速',
  content_type: 'routine_hint',
  revision: 1,
  status: 'enabled',
  scene: 'communication',
  instruction: '一次只说一件事，等待本人回应',
}
const reminder = {
  id: 'R-synthetic-care',
  elder_id: elder.id,
  title: '询问本次活动意愿',
  content_type: 'one_off_reminder',
  revision: 1,
  status: 'active',
  occasion: 'before_activity',
  service_date: day,
  record_what: '记录愿意参加、其他活动、想休息或尚未明确回应',
}
const capabilities = ['routine_hint', 'one_off_reminder', 'followup_task']
const advice = {
  id: 'AD-synthetic-care',
  elder_id: elder.id,
  revision: 1,
  title: '沟通建议',
  action: '沟通时一次说一件事',
  status: 'proposed',
  can_adopt: true,
  rationale: '虚构正式记录',
  uncertainty: '仍需现场核对',
  citations: [],
  feedback: [],
  recommended_content_type: 'routine_hint',
}
const task = {
  id: 'T-synthetic-care',
  elder_id: elder.id,
  elder_name: elder.name,
  bed_label: elder.bed_label,
  title: '虚构用餐跟进任务',
  revision: 1,
  status: 'pending',
  content_type: 'followup_task',
  assigned_to: staff.id,
  assignee_name: staff.display_name,
  shift_id: shift.id,
  shift_name: shift.name,
  due_at: day + 'T20:00:00+08:00',
  scheduled_at: day + 'T12:00:00+08:00',
  updated_at: new Date().toISOString(),
  allowed_actions: ['start', 'not_done'],
  source_plan_snapshot: { item: { scene: 'dining' } },
}

async function open({
  role = 'admin',
  mobile = false,
  guides = [],
  supported = capabilities,
  handler,
} = {}) {
  const context = await browser.newContext({
    viewport: { width: mobile ? 390 : 1440, height: 900 },
  })
  await context.addInitScript(
    ({ role, userId }) => {
      if (!sessionStorage.getItem('hulao:session:v2'))
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'synthetic-care-' + role,
            userId,
            role,
            accessToken: 'synthetic-test-only',
          }),
        )
    },
    { role, userId: staff.id },
  )
  const calls = []
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/v1', '')
    const body = req.postData() ? req.postDataJSON() : null
    const call = {
      path,
      method: req.method(),
      body,
      key: req.headers()['idempotency-key'],
    }
    calls.push(call)
    const respond = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      })
    if (handler && (await handler({ path, req, body, call, respond }))) return
    if (path === '/elders') return respond([elder])
    if (path === '/staff') return respond([staff])
    if (path === '/shifts') return respond([shift])
    if (path === '/tasks') return respond([task])
    if (path === '/tasks/' + task.id) return respond(task)
    if (path === `/elders/${elder.id}/care-guidance`)
      return respond({ elder_id: elder.id, items: guides })
    if (path === `/elders/${elder.id}/care-advice`)
      return respond({ supported_content_types: supported, items: [advice] })
    if (path === `/elders/${elder.id}/arrangement`)
      return respond({
        elder,
        assessment: { id: 'AS-synthetic' },
        needs_assessment: false,
        previous_plan: null,
        shifts: [shift],
        staff: [staff],
        memories: [],
        supported_content_types: supported,
        recommended_content_type: 'routine_hint',
      })
    if (path === '/followups')
      return respond({ counts: { pending: 0, review: 0 }, items: [] })
    return respond([], req.method() === 'GET' ? 200 : 405)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (e) => runtimeErrors.push(e.message))
  return { context, page, calls, app: mobile ? 'mobile' : 'admin' }
}
async function test(name, fn, options) {
  const env = await open(options)
  try {
    await fn(env)
    assert.equal(
      await env.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    )
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: String(error.stack || error),
      body: await env.page
        .locator('body')
        .innerText()
        .catch(() => ''),
    })
    await env.page
      .screenshot({
        path: `${output}/failure-${results.length}.png`,
        fullPage: true,
      })
      .catch(() => {})
    console.error('FAIL ' + name + ': ' + error.message)
  } finally {
    await env.context.close()
  }
}
const guidance = (page) =>
  page.getByRole('complementary', {
    name: '生活照护提示与本次提醒',
    exact: true,
  })
async function arrangement(page) {
  await page.goto(`${base}/admin/care-plan?elder=${elder.id}`)
  const panel = page.getByRole('region', { name: '照护安排', exact: true })
  await panel.getByRole('button', { name: /^日常提示/ }).waitFor()
  return panel
}
function mockArrangement({ path, body, respond }) {
  if (path.endsWith('/arrangement/preview'))
    return respond({
      elder_id: elder.id,
      content_type: body.content_type,
      context_token: 'synthetic-reviewed',
      items: body.items,
      unassigned_items: [],
    }).then(() => true)
  if (path.endsWith('/arrangement/confirm'))
    return respond({
      plan: {
        id: 'P-synthetic',
        elder_id: elder.id,
        content_type: body.content_type,
      },
      created_tasks: [],
      guidance: body.items.map((item, i) => ({
        ...item,
        id: 'G-synthetic-' + i,
        elder_id: elder.id,
        revision: 1,
        status: body.content_type === 'routine_hint' ? 'pending' : 'active',
        ...(body.content_type === 'one_off_reminder'
          ? { service_date: body.service_date }
          : {}),
      })),
    }).then(() => true)
  return false
}

try {
  await test(
    '管理端：先选采用方式；日常提示保留草稿且不提交任务字段',
    async ({ page, calls }) => {
      let panel = await arrangement(page)
      assert.equal(
        await panel.getByLabel('服务内容', { exact: true }).count(),
        0,
      )
      await panel.getByRole('button', { name: /^日常提示/ }).click()
      await panel
        .getByLabel('服务内容', { exact: true })
        .fill('虚构：沟通放慢语速')
      await panel
        .getByLabel('适用场景', { exact: true })
        .selectOption('communication')
      await panel
        .getByLabel('照护提示', { exact: true })
        .fill('最后一句刷新后仍保留')
      await page.reload()
      panel = page.getByRole('region', { name: '照护安排', exact: true })
      await panel.getByRole('button', { name: /^日常提示/ }).waitFor()
      assert.equal(
        await panel.getByLabel('照护提示', { exact: true }).inputValue(),
        '最后一句刷新后仍保留',
      )
      assert.equal(await panel.getByLabel('负责人', { exact: true }).count(), 0)
      assert.equal(
        await panel.getByLabel('服务时间', { exact: true }).count(),
        0,
      )
      await panel.getByRole('button', { name: '预览安排', exact: true }).click()
      await panel.getByRole('button', { name: '确认安排', exact: true }).click()
      await panel
        .getByRole('heading', { name: '安排已保存', exact: true })
        .waitFor()
      const body = calls.find((c) =>
        c.path.endsWith('/arrangement/confirm'),
      ).body
      assert.equal(body.content_type, 'routine_hint')
      for (const field of [
        'shift_id',
        'assigned_to',
        'service_date',
        'starts_on',
        'ends_on',
      ])
        assert.equal(field in body, false)
      for (const field of [
        'times',
        'weekdays',
        'window_minutes',
        'record_what',
      ])
        assert.equal(field in body.items[0], false)
      assert.equal(body.items[0].scene, 'communication')
    },
    { handler: mockArrangement },
  )

  await test(
    '管理端：本次提醒使用相对时机和自然记录要求；切换类型不泄漏字段',
    async ({ page, calls }) => {
      const panel = await arrangement(page)
      await panel.getByRole('button', { name: /^跟进任务/ }).click()
      assert.equal(
        await panel.getByLabel('负责人', { exact: true }).inputValue(),
        '',
      )
      await panel
        .getByLabel('服务内容', { exact: true })
        .fill('虚构：活动前询问')
      await panel
        .getByLabel('执行要求', { exact: true })
        .fill('不应泄漏的任务字段')
      await panel.getByRole('button', { name: /^本次照护提醒/ }).click()
      await panel
        .getByLabel('本次发生在', { exact: true })
        .selectOption('before_activity')
      await panel
        .getByLabel('需要记录什么', { exact: true })
        .fill('实际询问与回应，想休息也是有效回应')
      assert.equal(await panel.getByLabel('负责人', { exact: true }).count(), 0)
      await panel.getByRole('button', { name: '预览安排', exact: true }).click()
      await panel.getByRole('button', { name: '确认安排', exact: true }).click()
      await panel
        .getByRole('heading', { name: '安排已保存', exact: true })
        .waitFor()
      const body = calls.find((c) =>
        c.path.endsWith('/arrangement/confirm'),
      ).body
      assert.equal(body.service_date, day)
      assert.equal(body.items[0].occasion, 'before_activity')
      for (const field of [
        'times',
        'instruction',
        'weekdays',
        'assigned_to',
        'due_at',
      ])
        assert.equal(field in body.items[0], false)
    },
    { handler: mockArrangement },
  )

  await test(
    '旧服务未声明能力：保留编辑但阻止新类型提交',
    async ({ page, calls }) => {
      const panel = await arrangement(page)
      await panel.getByRole('button', { name: /^日常提示/ }).click()
      await panel.getByLabel('服务内容', { exact: true }).fill('虚构提示')
      await panel
        .getByLabel('照护提示', { exact: true })
        .fill('人工确认前不生效')
      await panel.getByRole('button', { name: '预览安排', exact: true }).click()
      await panel
        .getByText('当前服务尚未声明支持这种采用方式', { exact: false })
        .waitFor()
      assert.equal(
        calls.some((c) => c.method === 'POST'),
        false,
      )
      assert.equal(
        await panel
          .getByRole('heading', { name: '安排已保存', exact: true })
          .count(),
        0,
      )
    },
    {
      supported: undefined,
      handler: async ({ path, respond }) => {
        if (path.endsWith('/arrangement')) {
          await respond({
            elder,
            shifts: [],
            staff: [],
            memories: [],
            needs_assessment: false,
            assessment: {},
          })
          return true
        }
        return false
      },
    },
  )

  await test(
    '护理员建议卡：排班服务故障不阻止日常提示；必须人工选择类型',
    async ({ page, calls }) => {
      await page.goto(`${base}/mobile/elders/${elder.id}`)
      const panel = page.getByRole('region', {
        name: '个性化生活照护安排',
        exact: true,
      })
      await panel
        .getByRole('button', { name: '采用并选择处理方式', exact: true })
        .click()
      assert.equal(
        await panel.getByLabel('安排内容', { exact: true }).count(),
        0,
      )
      await panel.getByRole('button', { name: /^日常提示/ }).click()
      await panel
        .getByLabel('照护提示', { exact: true })
        .fill('虚构：等待老人回应')
      await panel
        .getByLabel('采用说明', { exact: true })
        .fill('现场核对后提交主管确认')
      await panel.getByRole('button', { name: '确认采用', exact: true }).click()
      await panel.getByText('服务器已确认本次操作', { exact: false }).waitFor()
      const body = calls.find((c) => c.path.endsWith('/adopt')).body
      assert.equal(body.content_type, 'routine_hint')
      assert.equal('task' in body, false)
      assert.equal('assigned_to' in body, false)
      assert.equal(body.instruction, '虚构：等待老人回应')
    },
    {
      role: 'caregiver',
      mobile: true,
      handler: async ({ path, body, respond }) => {
        if (path === '/shifts' || path === '/staff') {
          await respond({ detail: '合成目录故障' }, 503)
          return true
        }
        if (path.endsWith('/adopt')) {
          await respond({
            ...advice,
            revision: 2,
            status: 'adopted',
            content_type: body.content_type,
            guidance: {
              ...hint,
              status: 'pending',
              instruction: body.instruction,
            },
          })
          return true
        }
        return false
      },
    },
  )

  const managedHint = { ...hint, status: 'pending' }
  await test(
    '管理端：四态独立管理；说明即时刷新恢复且带版本提交',
    async ({ page, calls }) => {
      await page.goto(`${base}/admin/elders/${elder.id}`)
      let panel = guidance(page)
      await panel
        .getByRole('button', { name: '人工确认启用', exact: true })
        .click()
      await panel
        .getByLabel('处理说明', { exact: true })
        .fill('虚构：与本人核对后启用')
      await page.reload()
      panel = guidance(page)
      assert.equal(
        await panel.getByLabel('处理说明', { exact: true }).inputValue(),
        '虚构：与本人核对后启用',
      )
      await panel
        .getByRole('button', { name: '确认状态变更', exact: true })
        .click()
      await panel.locator('.workspace-badge').getByText('已启用', { exact: true }).waitFor()
      await panel.getByRole('button', { name: '停用提示', exact: true }).click()
      await panel
        .getByLabel('处理说明', { exact: true })
        .fill('虚构：本人提出调整')
      await panel
        .getByRole('button', { name: '确认状态变更', exact: true })
        .click()
      await panel.locator('.workspace-badge').getByText('已停用', { exact: true }).waitFor()
      const writes = calls.filter((c) => c.path.endsWith('/status'))
      assert.deepEqual(
        writes.map((c) => c.body.expected_revision),
        [1, 2],
      )
      assert.deepEqual(
        writes.map((c) => c.body.status),
        ['enabled', 'disabled'],
      )
    },
    {
      guides: [managedHint],
      handler: async ({ path, body, respond }) => {
        if (path.endsWith(`/${hint.id}/status`)) {
          Object.assign(managedHint, {
            status: body.status,
            revision: managedHint.revision + 1,
          })
          await respond(managedHint)
          return true
        }
        return false
      },
    },
  )

  const recordGuides = [
    hint,
    {
      ...hint,
      id: 'H-pending',
      status: 'pending',
      title: '不得展示的未确认提示',
    },
    {
      ...hint,
      id: 'H-stopped',
      status: 'disabled',
      title: '不得展示的停用提示',
    },
    { ...hint, id: 'H-meal', scene: 'dining', title: '用餐提示' },
    reminder,
    {
      ...reminder,
      id: 'R-expired',
      service_date: '2020-01-01',
      title: '不得展示的过期提醒',
    },
  ]
  await test(
    '护理员记录页：场景过滤，隐藏未确认、停用和过期内容，无日常打卡',
    async ({ page }) => {
      await page.goto(`${base}/mobile/elders/${elder.id}?section=records`)
      const panel = guidance(page)
      await panel.getByText(hint.title, { exact: true }).waitFor()
      assert.equal(
        await panel.getByText('不得展示', { exact: false }).count(),
        0,
      )
      assert.equal(
        await panel
          .getByRole('button', { name: '人工确认启用', exact: true })
          .count(),
        0,
      )
      await page.getByRole('combobox', { name: /^照护场景/ }).selectOption('dining')
      await panel.getByText('用餐提示', { exact: true }).waitFor()
      assert.equal(
        await panel.getByText(hint.title, { exact: true }).count(),
        0,
      )
      assert.equal(
        await panel.getByText(reminder.title, { exact: true }).count(),
        0,
      )
      await page.screenshot({
        path: `${output}/mobile-guidance.png`,
        fullPage: true,
      })
    },
    { role: 'caregiver', mobile: true, guides: recordGuides },
  )

  const recordedReminder = { ...reminder }
  const attempts = []
  await test(
    '本次回应：想休息可保存；断线后刷新复用原请求，不生成任务或长期习惯',
    async ({ page, calls }) => {
      await page.goto(`${base}/mobile/elders/${elder.id}`)
      let panel = guidance(page)
      await panel
        .getByRole('button', { name: '记录本次回应', exact: true })
        .click()
      await panel
        .getByLabel('老人本次回应', { exact: true })
        .selectOption('rest')
      await panel
        .getByLabel('实际询问与回应', { exact: true })
        .fill('虚构：已询问，老人表示想休息，尊重其本次选择。')
      await panel
        .getByRole('button', { name: '保存本次实际记录', exact: true })
        .click()
      await panel
        .getByRole('button', { name: '核实上次提示操作', exact: true })
        .waitFor()
      await page.reload()
      panel = guidance(page)
      assert.equal(
        await panel.getByLabel('老人本次回应', { exact: true }).inputValue(),
        'rest',
      )
      await panel
        .getByRole('button', { name: '核实上次提示操作', exact: true })
        .click()
      await panel
        .getByText('本次回应已保存为正式记录', { exact: false })
        .waitFor()
      assert.equal(attempts.length, 2)
      assert.ok(attempts[0].key)
      assert.deepEqual(attempts[0], attempts[1])
      assert.equal(attempts[1].body.response, 'rest')
      assert.equal(
        calls.some(
          (c) => c.method === 'POST' && /\/tasks|\/memories/.test(c.path),
        ),
        false,
      )
    },
    {
      role: 'caregiver',
      mobile: true,
      guides: [recordedReminder],
      handler: async ({ path, call, respond }) => {
        if (path.endsWith(`/${reminder.id}/record`)) {
          attempts.push(call)
          if (attempts.length === 1)
            await respond({ detail: '合成回执中断' }, 500)
          else {
            Object.assign(recordedReminder, { revision: 2, status: 'recorded' })
            await respond({
              guidance: recordedReminder,
              record: { id: 'REC-synthetic-care', elder_id: elder.id },
            })
          }
          return true
        }
        return false
      },
    },
  )

  await test(
    '提示接口缺失时明确报错，不伪装成无提示或保存成功',
    async ({ page }) => {
      await page.goto(`${base}/mobile/elders/${elder.id}`)
      const panel = guidance(page)
      await panel
        .getByRole('alert')
        .filter({ hasText: '照护提示暂未读取' })
        .waitFor()
      assert.equal(
        await panel
          .getByText('当前没有符合条件的有效提示或本次提醒。', { exact: true })
          .count(),
        0,
      )
    },
    {
      role: 'caregiver',
      mobile: true,
      handler: async ({ path, respond }) => {
        if (path.endsWith('/care-guidance')) {
          await respond({ detail: '合成未接入' }, 404)
          return true
        }
        return false
      },
    },
  )

  await test(
    '办理相关任务：仅展示匹配场景的生活提示',
    async ({ page }) => {
      await page.goto(`${base}/mobile/tasks/${task.id}`)
      const panel = guidance(page)
      await panel.getByText('用餐提示', { exact: true }).waitFor()
      assert.equal(
        await panel.getByText(hint.title, { exact: true }).count(),
        0,
      )
    },
    { role: 'caregiver', mobile: true, guides: recordGuides },
  )

  assert.deepEqual(runtimeErrors, [])
} finally {
  await browser.close()
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, runtimeErrors }, null, 2),
  )
}
if (results.some((r) => !r.passed) || runtimeErrors.length) process.exitCode = 1

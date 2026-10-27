import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Synthetic HTTP contracts only. This suite is not real-backend acceptance.
const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
const output = resolve('test-results/checklist-v2')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'msedge',
})
const fixturePage = await browser.newPage()
const jpeg = Buffer.from(
  await fixturePage.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const context = canvas.getContext('2d')
    context.fillStyle = '#d4e8df'
    context.fillRect(0, 0, 2, 2)
    return canvas.toDataURL('image/jpeg').split(',')[1]
  }),
  'base64',
)
const png = Buffer.from(
  await fixturePage.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 3
    canvas.height = 3
    return canvas.toDataURL('image/png').split(',')[1]
  }),
  'base64',
)
await fixturePage.close()
const results = [],
  errors = []
const elders = [
  {
    id: 'ELDER-one',
    name: '虚构张阿姨',
    bed_id: 'BED-one',
    bed_label: '101床',
    current_admission_id: 'ADM-one',
    status: 'active',
    revision: 1,
  },
  {
    id: 'ELDER-two',
    name: '虚构李爷爷',
    bed_id: 'BED-two',
    bed_label: '102床',
    current_admission_id: 'ADM-two',
    status: 'active',
    revision: 1,
  },
]
const staff = {
  id: 'USER-one',
  display_name: '虚构护理员',
  role: 'caregiver',
  active: true,
}
const shift = {
  id: 'SHIFT-one',
  name: '虚构早班',
  start_at: '2026-10-25T00:00:00+08:00',
  end_at: '2026-10-26T00:00:00+08:00',
  status: 'open',
  caregiver_ids: [staff.id],
  revision: 1,
}
const records = elders.map((elder, i) => ({
  id: 'REC-' + (i + 1),
  elder_id: elder.id,
  admission_id: elder.current_admission_id,
  raw_text: '虚构人工观察' + (i + 1),
  observations: ['虚构人工观察' + (i + 1)],
  revision: 1,
  status: 'confirmed',
  created_by: staff.id,
  created_at: '2026-10-24T09:00:00+08:00',
  happened_at: '2026-10-24T08:00:00+08:00',
}))
const tasks = elders.map((elder, i) => ({
  id: 'TASK-' + (i + 1),
  elder_id: elder.id,
  title: '虚构关联任务' + (i + 1),
  status: 'pending',
  shift_id: shift.id,
  assigned_to: staff.id,
  due_at: '2026-10-25T15:00:00+08:00',
  created_at: '2026-10-24T09:00:00+08:00',
  updated_at: '2026-10-24T09:00:00+08:00',
  revision: 1,
  source_record_id: records[i].id,
  memory_references: [],
}))
const photo = {
  id: 'PHOTO-one',
  elder_id: elders[0].id,
  admission_id: 'ADM-one',
  occurred_at: '2026-10-24T09:00:00+08:00',
  created_at: '2026-10-24T09:00:00+08:00',
  caption: '虚构照片',
  created_by: staff.id,
  status: 'pending_review',
  revision: 1,
  reviews: [],
  links: [],
  mime: 'image/jpeg',
  size_bytes: 100,
  width: 1,
  height: 1,
}
const analysis = {
  id: 'IMAGE-one',
  attachment_id: photo.id,
  elder_id: photo.elder_id,
  admission_id: photo.admission_id,
  created_by: staff.id,
  created_at: photo.created_at,
  revision: 2,
  status: 'pending_review',
  model_status: 'visible_observations',
  reviews: [],
  record_id: null,
  output: {
    status: 'visible_observations',
    observations: ['虚构可见颜色变化'],
    missing_information: ['观察背景'],
    verification_items: ['请人工核对'],
    requires_professional_review: true,
  },
  warning: 'AI识别可能有误，不构成诊断或处置建议。',
}
const notice = {
  id: 'NOTICE-one',
  object_type: 'image_analyses',
  object_id: analysis.id,
  elder_id: elders[0].id,
  title: '虚构照片待核对',
  stage: 'photo_review',
  status: 'pending',
  revision: 1,
  created_at: photo.created_at,
  read_at: null,
  accepted_at: null,
}
const sectionKeys = [
  'tasks',
  'handovers',
  'incidents',
  'memories',
  'impressions',
  'family',
  'photo_reviews',
]
const cardKeys = [
  'pending_tasks',
  'overdue_tasks',
  'pending_handovers',
  'untriaged_incidents',
  'pending_rectification_review',
  'pending_reviews',
]
function dashboard(url, empty = false) {
  const start = url.searchParams.get('start'),
    end = url.searchParams.get('end')
  const filters = {
    start_inclusive: start + 'T00:00:00+08:00',
    end_exclusive: end + 'T00:00:00+08:00',
    elder_id: url.searchParams.get('elder_id'),
    shift_id: url.searchParams.get('shift_id'),
    status: url.searchParams.get('status'),
  }
  const rows = (empty ? [] : tasks)
    .filter(
      (t) =>
        (!filters.elder_id || t.elder_id === filters.elder_id) &&
        (!filters.shift_id || t.shift_id === filters.shift_id) &&
        (!filters.status || t.status === filters.status),
    )
    .map((t) => ({
      ...t,
      kind: 'task',
      elder_name: elders.find((e) => e.id === t.elder_id).name,
      assigned_name: staff.display_name,
      metric_at: start + 'T10:00:00+08:00',
      is_plan_occurrence: false,
      scheduled_at: null,
    }))
  const details = Object.fromEntries(
    sectionKeys.map((k) => [k, { count: 0, items: [] }]),
  )
  details.tasks = { count: rows.length, items: rows }
  const cards = Object.fromEntries(
    cardKeys.map((k) => [
      k,
      { count: 0, previous_count: 0, change: 0, change_ratio: null, items: [] },
    ]),
  )
  cards.pending_tasks = {
    ...cards.pending_tasks,
    count: rows.length,
    change: rows.length,
    items: rows,
  }
  const distributions = Object.fromEntries(
    [...sectionKeys, 'incident_categories', 'family_kind'].map((k) => [k, []]),
  )
  distributions.tasks = rows.length
    ? [{ key: 'pending', count: rows.length, ids: rows.map((r) => r.id) }]
    : []
  const task_trend = []
  for (
    let instant = Date.parse(start + 'T00:00:00Z');
    instant < Date.parse(end + 'T00:00:00Z');
    instant += 86400000
  )
    task_trend.push({
      date: new Date(instant).toISOString().slice(0, 10),
      count: 0,
      ids: [],
      completion: { numerator: 0, denominator: 0, ratio: null },
      on_time: 0,
      not_done: 0,
      overdue: 0,
    })
  const previousStart = new Date(
    Date.parse(start + 'T00:00:00Z') - (Date.parse(end) - Date.parse(start)),
  )
    .toISOString()
    .slice(0, 10)
  return {
    as_of: start + 'T12:00:00+08:00',
    timezone: 'Asia/Shanghai',
    filters,
    details,
    cards,
    distributions,
    task_trend,
    pending_work: {
      count: rows.length,
      items: rows.map((r) => ({
        ...r,
        priority_order: 3,
        priority_reason: '虚构排序',
      })),
      definition: '服务器业务状态',
    },
    comparison: {
      filters: {
        ...filters,
        start_inclusive: previousStart + 'T00:00:00+08:00',
        end_exclusive: filters.start_inclusive,
      },
      cards: Object.fromEntries(
        cardKeys.map((k) => [k, { count: 0, items: [] }]),
      ),
      definition: '相邻周期按当前快照比较',
    },
    excluded: { future_trend_task_rows: 0, invalid_task_time_rows: 0 },
    definitions: { snapshot: '同一虚构快照', task_trend: '仅计划任务' },
  }
}
async function setup(role = 'caregiver') {
  const context = await browser.newContext({
    viewport: { width: role === 'caregiver' ? 390 : 1366, height: 900 },
  })
  const calls = [],
    writes = []
  const state = {
    notices: [structuredClone(notice)],
    photos: [],
    analysis: structuredClone(analysis),
    assignments: [],
    scope: true,
    failNotices: false,
    noticeDelay: 0,
    failDashboard: false,
    invalidDashboard: false,
    failReview: false,
    failUpload: false,
    configured: true,
  }
  await context.addInitScript(
    ({ role }) =>
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          mode: 'api',
          accountKey: 'isolated-checklist-' + role,
          userId: 'USER-one',
          role,
          accessToken: 'synthetic-test-not-a-real-token',
        }),
      ),
    { role },
  )
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '')
    calls.push({
      path,
      method: req.method(),
      query: url.search,
      auth: req.headers().authorization,
    })
    const json = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      })
    if (state.denyPhotos && path.startsWith('/attachments'))
      return json({ detail: 'synthetic scope revoked' }, 403)
    if (req.method() !== 'GET') {
      const body =
        path === '/attachments'
          ? {
              bytes: req.postDataBuffer()?.length,
              contentType: req.headers()['content-type'],
            }
          : req.postData()
            ? req.postDataJSON()
            : null
      writes.push({ path, body, key: req.headers()['idempotency-key'] })
      if (path === '/attachments') {
        if (state.rejectUpload)
          return json(
            {
              error_code: 'attachment_format_mismatch',
              safe_message: '照片格式无法确认，请转换后重试。',
            },
            415,
          )
        if (!state.photos.length) state.photos.push(structuredClone(photo))
        return state.failUpload
          ? json({ detail: 'synthetic uncertain upload' }, 503)
          : json(state.photos[0], 201)
      }
      if (path.endsWith('/analyze')) return json(state.analysis, 202)
      if (path.endsWith('/review')) {
        if (state.failReview)
          return json({ detail: 'synthetic uncertain review' }, 503)
        state.analysis = {
          ...state.analysis,
          revision: state.analysis.revision + 1,
          status:
            body.decision === 'confirm'
              ? 'confirmed'
              : body.decision === 'reject'
                ? 'rejected'
                : 'pending_management',
          reviews: [...state.analysis.reviews, body],
          record_id: body.decision === 'confirm' ? 'REC-photo' : null,
        }
        return json(state.analysis)
      }
      if (path === '/incidents')
        return json(
          {
            id: 'INCIDENT-one',
            ...body,
            revision: 1,
            status: 'reported',
            created_by: staff.id,
          },
          201,
        )
      if (path.endsWith('/actions')) {
        if (state.failNoticeAction)
          return json({ detail: 'synthetic version conflict' }, 409)
        const row = state.notices.find((item) => item.id === path.split('/')[2])
        row.revision++
        if (body.action === 'read') row.read_at = new Date().toISOString()
        else {
          row.status = 'accepted'
          row.accepted_at = new Date().toISOString()
        }
        return json(row)
      }
      if (path === '/elders/work-assignments') {
        const row = { id: 'SCOPE-one', ...body, revision: 1, status: 'active' }
        state.assignments = [row]
        return state.failAssignment
          ? json({ detail: 'synthetic uncertain assignment' }, 503)
          : json(row, 201)
      }
      if (path.endsWith('/revoke')) {
        state.assignments[0].status = 'revoked'
        state.assignments[0].revision++
        return json(state.assignments[0])
      }
      return json({ detail: 'unexpected synthetic write' }, 422)
    }
    if (path === '/elders/worklist/me')
      return json({
        scope_rule: '仅当前有效范围',
        items: state.scope
          ? elders.map((e, i) => ({
              elder: e,
              scope_reasons: ['explicit_assignment'],
              open_tasks: i ? [] : [tasks[0]],
              assignment_ids: ['SCOPE-one'],
              pending_count: i ? 0 : 1,
              overdue_count: 0,
            }))
          : [],
      })
    if (/^\/elders\/.+\/timeline$/.test(path)) {
      const elderId = path.split('/')[2],
        i = elders.findIndex((e) => e.id === elderId)
      let events = [
        {
          id: 'EVENT-record',
          source_id: records[i].id,
          event_type: 'record',
          action: 'create_manual_record',
          label: '人工记录',
          detail: records[i].raw_text,
          actor: staff.display_name,
          happened_at: records[i].happened_at,
          entered_at: records[i].created_at,
        },
        {
          id: 'EVENT-task',
          source_id: tasks[i].id,
          event_type: 'task',
          action: 'create_task',
          label: tasks[i].title,
          detail: '',
          actor: staff.display_name,
          happened_at: tasks[i].created_at,
          entered_at: tasks[i].created_at,
        },
      ]
      events = events.filter(
        (e) =>
          (!url.searchParams.get('event_type') ||
            e.event_type === url.searchParams.get('event_type')) &&
          (!url.searchParams.get('start') ||
            Date.parse(e.happened_at) >=
              Date.parse(url.searchParams.get('start'))) &&
          (!url.searchParams.get('end') ||
            Date.parse(e.happened_at) <
              Date.parse(url.searchParams.get('end'))),
      )
      return json({
        elder_id: elderId,
        events,
        total: events.length,
        offset: 0,
        limit: 100,
        has_more: false,
        notice: '仅服务器授权的登记事件',
      })
    }
    if (path === '/notifications') {
      if (state.noticeDelay)
        await new Promise((r) => setTimeout(r, state.noticeDelay))
      if (state.failNotices)
        return json({ detail: 'synthetic temporarily unavailable' }, 503)
      const rows = state.notices.filter(
        (n) =>
          (url.searchParams.get('unread') !== 'true' || !n.read_at) &&
          (url.searchParams.get('pending') !== 'true' || n.status !== 'closed'),
      )
      const offset = Number(url.searchParams.get('offset')),
        limit = Number(url.searchParams.get('limit'))
      return json({
        items: rows.slice(offset, offset + limit),
        total: rows.length,
        offset,
        limit,
        as_of: new Date().toISOString(),
        definition: '仅服务端通知',
      })
    }
    if (path === '/attachments/vision/status')
      return json({
        configured: state.configured,
        model: 'synthetic',
        warning: analysis.warning,
      })
    if (path === '/attachments')
      return json({
        items: state.photos.filter(
          (p) => p.elder_id === url.searchParams.get('elder_id'),
        ),
        total: state.photos.filter(
          (p) => p.elder_id === url.searchParams.get('elder_id'),
        ).length,
      })
    if (path === '/attachments/analyses/IMAGE-one') return json(state.analysis)
    if (path === '/attachments/PHOTO-one') return json(photo)
    if (path === '/attachments/PHOTO-one/content')
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: jpeg,
      })
    if (path === '/reports/dashboard')
      return state.failDashboard
        ? json({ detail: 'synthetic unavailable' }, 503)
        : json(
            state.invalidDashboard ? {} : dashboard(url, state.emptyDashboard),
          )
    if (path === '/elders') return json(elders)
    if (path === '/tasks') return json(tasks)
    if (/^\/tasks\/TASK-/.test(path))
      return json(tasks.find((row) => path.endsWith(row.id)))
    if (path === '/records')
      return json(
        state.noRecords
          ? []
          : state.photoRecord
            ? [
                {
                  ...records[0],
                  id: 'REC-photo',
                  source_attachment_ids: [photo.id],
                  source_image_analysis_id: analysis.id,
                },
              ]
            : records,
      )
    if (path === '/family/cases')
      return json([
        {
          id: 'SUMMARY-one',
          kind: 'summary',
          elder_id: 'ELDER-one',
          status: 'draft',
          revision: 1,
          content: '虚构待审简报',
          evidence: [],
        },
      ])
    if (/^\/records\/REC-/.test(path))
      return json(
        records.find((row) => path.endsWith(row.id)) || {
          ...records[0],
          id: 'REC-photo',
          source_attachment_ids: [photo.id],
          source_image_analysis_id: analysis.id,
        },
      )
    if (path === '/shifts') return json([shift])
    if (path === '/staff' || path === '/staff/directory') return json([staff])
    if (/\/admissions$/.test(path))
      return json(
        elders
          .filter((row) => path.includes(row.id))
          .map((row) => ({
            id: row.current_admission_id,
            elder_id: row.id,
            status: 'active',
          })),
      )
    if (path === '/memories/context')
      return json({
        elder_id: url.searchParams.get('elder_id'),
        scene: url.searchParams.get('scene'),
        memories: [],
      })
    if (path.includes('impression'))
      return json({ detail: 'impression_no_records' }, 422)
    return json([])
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, calls, writes, state }
}
const field = (page, path) =>
  page
    .locator(`[data-field="填写办理内容.${path}"]`)
    .locator('input,textarea,select')
    .first()
async function noOverflow(page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert.ok(size.scroll <= size.width + 1, JSON.stringify(size))
}
async function test(name, fn, role) {
  if (
    process.env.CHECKLIST_FILTER &&
    !new RegExp(process.env.CHECKLIST_FILTER).test(name)
  )
    return
  const env = await setup(role)
  try {
    await fn(env)
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: String(error.stack),
      body: await env.page.locator('body').innerText(),
    })
    await env.page.screenshot({
      path: resolve(output, 'failure-' + results.length + '.png'),
      fullPage: true,
    })
    console.error('FAIL ' + name + ': ' + error.message)
  } finally {
    await env.context.close()
  }
}
try {
  await test('当前照护范围包括零任务老人，撤销后不保留旧范围', async ({
    page,
    state,
  }) => {
    await page.goto(base + '/mobile/caregiver')
    await page
      .locator('.elder-card-title')
      .filter({ hasText: '虚构李爷爷' })
      .waitFor()
    state.scope = false
    await page
      .getByRole('button', { name: '刷新任务与老人', exact: true })
      .click()
    await page
      .getByText('当前没有授权照护的老人，请联系主管安排照护范围。', {
        exact: true,
      })
      .waitFor()
    assert.equal(await page.locator('.elder-card-title').count(), 0)
  })
  await test('老人动态使用服务器过滤与精确来源，窄屏无溢出', async ({
    page,
    calls,
  }) => {
    await page.goto(base + '/mobile/elders/ELDER-one?section=records')
    await page.getByText('完整照护过程', { exact: true }).click()
    const activity = page.getByRole('region', { name: '老人动态', exact: true })
    await activity.getByText('虚构人工观察1', { exact: true }).waitFor()
    await activity
      .getByRole('combobox', { name: /^类型/ })
      .selectOption('record')
    await activity
      .getByRole('button', { name: '查看照护记录详情', exact: true })
      .click()
    await page
      .getByRole('region', { name: '动态来源与详情' })
      .getByText('虚构人工观察1', { exact: true })
      .waitFor()
    assert.ok(calls.some((c) => c.path === '/records/REC-1'))
    assert.ok(!calls.some((c) => c.path === '/records/REC-2'))
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await noOverflow(page)
    }
  })
  await test('切换老人清空任务原文和上下文', async ({ page }) => {
    await page.goto(base + '/mobile/tasks/new?elder=ELDER-one')
    await field(page, 'title').fill('原老人任务不能迁移')
    await field(page, 'condition').fill('原老人执行前提')
    await field(page, 'elder_id').selectOption('ELDER-two')
    assert.equal(await field(page, 'title').inputValue(), '')
    assert.equal(await field(page, 'condition').inputValue(), '')
    await page
      .getByRole('region', { name: '所选老人的任务与照护提示' })
      .getByText('虚构关联任务2', { exact: false })
      .waitFor()
  })
  await test('无正式记录证据可直接人工上报，单次写入且不调用AI', async ({
    page,
    writes,
    calls,
    state,
  }) => {
    state.noRecords = true
    await page.goto(base + '/mobile/safety?elder=ELDER-one&report=1')
    await field(page, 'elder_id').waitFor()
    await field(page, 'occurred_at').fill('2026-10-24T10:00')
    await field(page, 'description').fill('虚构事实，人工核对')
    await field(page, 'immediate_action').fill('虚构已采取措施')
    await page.getByRole('button', { name: '核对并继续', exact: true }).click()
    await page.getByRole('button', { name: '确认提交', exact: true }).click()
    await page
      .getByText('已保存，服务器已确认成功。', { exact: true })
      .waitFor()
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].body.evidence, [])
    assert.ok(writes[0].key)
    assert.ok(!calls.some((c) => /extract|ai-summary|speech/.test(c.path)))
  })
  await test('通知已读与接单使用服务端版本，并保留关联识别编号', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/notifications')
    await page.getByRole('button', { name: /^待复查/ }).click()
    await page.getByRole('button', { name: '标记已读', exact: true }).click()
    await page.getByText(/已读：/).waitFor()
    await page.getByRole('button', { name: '接单办理', exact: true }).click()
    await page.getByText('已接单', { exact: true }).waitFor()
    assert.deepEqual(
      writes.map((w) => w.body.expected_revision),
      [1, 2],
    )
    await page.getByRole('link', { name: '进入关联业务', exact: true }).click()
    await page.waitForURL(/analysis_id=IMAGE-one/)
    await page
      .getByRole('button', { name: '提交主管审核', exact: true })
      .waitFor()
  })
  await test('通知读取异常明确提示，并在账号切换时清除旧通知', async ({
    page,
    state,
  }) => {
    state.failNotices = true
    await page.goto(base + '/mobile/notifications')
    await page.getByRole('button', { name: /^待复查/ }).click()
    await page.locator('.server-notifications .error').waitFor()
    state.failNotices = false
    await page
      .getByRole('button', { name: '刷新照护跟进', exact: true })
      .click()
    await page.getByText('虚构照片待核对', { exact: true }).waitFor()
    state.notices = []
    await page.evaluate(() => {
      const s = JSON.parse(sessionStorage.getItem('hulao:session:v2'))
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          ...s,
          accountKey: 'synthetic-second',
          userId: 'USER-two',
        }),
      )
      window.dispatchEvent(new StorageEvent('storage'))
    })
    await page
      .getByText(
        '当前通知页的分类与业务筛选下没有事项；可切换分类或翻页查看。',
        { exact: true },
      )
      .waitFor()
    assert.equal(
      await page.getByText('虚构照片待核对', { exact: true }).count(),
      0,
    )
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await noOverflow(page)
    }
  })
  await test('通知服务器分页与未读筛选，409重试复用请求且不完成业务', async ({
    page,
    state,
    writes,
    calls,
  }) => {
    state.notices = Array.from({ length: 105 }, (_, index) => ({
      ...notice,
      id: 'NOTICE-' + index,
      title: '虚构通知' + index,
      read_at: index % 2 ? null : '2026-10-24T10:00:00+08:00',
    }))
    await page.goto(base + '/mobile/notifications')
    await page.getByRole('button', { name: /^待复查/ }).click()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await page.getByText('虚构通知100', { exact: true }).waitFor()
    await page
      .getByRole('checkbox', { name: '仅未读（服务器筛选）', exact: true })
      .check()
    await page.getByText('虚构通知1', { exact: true }).waitFor()
    assert.equal(await page.getByText('虚构通知0', { exact: true }).count(), 0)
    state.failNoticeAction = true
    await page
      .getByRole('button', { name: '标记已读', exact: true })
      .first()
      .click()
    await page.getByRole('alert').waitFor()
    state.failNoticeAction = false
    await page
      .getByRole('button', { name: '标记已读', exact: true })
      .first()
      .click()
    await page
      .getByText('虚构通知1', { exact: true })
      .waitFor({ state: 'hidden' })
    assert.equal(writes.length, 2)
    assert.equal(writes[0].key, writes[1].key)
    assert.deepEqual(writes[0].body, writes[1].body)
    assert.ok(
      calls.some(
        (call) =>
          call.path === '/notifications' && call.query.includes('offset=100'),
      ),
    )
    assert.ok(writes.every((write) => write.path.startsWith('/notifications/')))
  })
  await test(
    '主管手机通知打开具体家属简报审核表单',
    async ({ page, state, writes }) => {
      state.notices = [
        {
          ...notice,
          object_type: 'family_cases',
          object_id: 'SUMMARY-one',
          stage: 'summary_review',
        },
      ]
      await page.goto(base + '/mobile/notifications')
      await page.getByRole('button', { name: /^待复查/ }).click()
      await page
        .getByRole('link', { name: '进入关联业务', exact: true })
        .click()
      await page.waitForURL(
        /notifications\/business\/family.*summary_id=SUMMARY-one/,
      )
      await page
        .getByRole('heading', { name: '家属沟通办理', exact: true })
        .waitFor()
      assert.equal(
        new URL(page.url()).searchParams.get('action'),
        '/family/summaries/{summary_id}/review',
      )
      await noOverflow(page)
      assert.equal(writes.length, 0)
    },
    'supervisor',
  )
  await test('照片按实际字节识别格式，JPEG文件名下的PNG可以上传', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-one')
    const region = page.getByRole('region', {
      name: '照片辅助观察',
      exact: true,
    })
    await page.waitForFunction(
      () =>
        document.querySelector('.photo-form input[type="file"]')?.disabled ===
        false,
    )
    await region
      .getByLabel('拍照或选择照片')
      .setInputFiles({ name: 'OIP.jpg', mimeType: 'image/jpeg', buffer: png })
    await region
      .getByRole('button', { name: '上传并保存照片', exact: true })
      .click()
    await region
      .getByRole('button', { name: '整理可见观察', exact: true })
      .waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].body.contentType, 'image/png')
    assert.equal(await region.getByText(/上传结果待核实/).count(), 0)
  })
  await test('照片明确拒绝后解除锁定，可换文件重新上传', async ({
    page,
    writes,
    state,
  }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-one')
    const region = page.getByRole('region', {
      name: '照片辅助观察',
      exact: true,
    })
    await page.waitForFunction(
      () =>
        document.querySelector('.photo-form input[type="file"]')?.disabled ===
        false,
    )
    state.rejectUpload = true
    await region.getByLabel('拍照或选择照片').setInputFiles({
      name: 'first.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    })
    await region
      .getByRole('button', { name: '上传并保存照片', exact: true })
      .click()
    await region
      .getByRole('alert')
      .filter({ hasText: '照片格式无法确认' })
      .waitFor()
    assert.equal(await region.getByText(/上传结果待核实/).count(), 0)
    assert.equal(await region.getByLabel('照片说明').isDisabled(), false)
    state.rejectUpload = false
    await region
      .getByLabel('拍照或选择照片')
      .setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: png })
    await region
      .getByRole('button', { name: '上传并保存照片', exact: true })
      .click()
    await region
      .getByRole('button', { name: '整理可见观察', exact: true })
      .waitFor()
    assert.equal(writes.length, 2)
    assert.notEqual(writes[0].key, writes[1].key)
  })
  await test('照片二进制上传、失败固定请求重试、专业审核和切换老人清理', async ({
    page,
    writes,
    state,
    calls,
  }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-one')
    const region = page.getByRole('region', {
      name: '照片辅助观察',
      exact: true,
    })
    await page.waitForFunction(
      () =>
        document.querySelector('.photo-form input[type="file"]')?.disabled ===
        false,
    )
    await region.getByLabel('拍照或选择照片').setInputFiles({
      name: 'synthetic.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    })
    state.failUpload = true
    await region
      .getByRole('button', { name: '上传并保存照片', exact: true })
      .click()
    await region.getByText(/上传结果待核实/).waitFor()
    await page.waitForFunction(
      () => !document.querySelector('.photo-form button')?.disabled,
    )
    assert.ok(await region.getByLabel('照片说明').isDisabled())
    state.failUpload = false
    await region
      .getByRole('button', { name: '上传并保存照片', exact: true })
      .click()
    await region
      .getByRole('button', { name: '整理可见观察', exact: true })
      .click()
    await region.getByLabel('人工核对观察').fill('人工修正的虚构观察')
    await region.getByLabel('核对说明').fill('人工核对后请主管确认')
    assert.equal(
      await region
        .getByRole('button', { name: '人工核对并保存正式记录', exact: true })
        .count(),
      0,
    )
    await region
      .getByRole('button', { name: '提交主管审核', exact: true })
      .click()
    await region
      .getByText('已提交主管审核，护理员不能绕过专业审核。', { exact: true })
      .waitFor()
    await page.screenshot({
      path: resolve(output, 'mobile-photo-review.png'),
      fullPage: true,
    })
    const uploads = writes.filter((w) => w.path === '/attachments')
    assert.equal(uploads.length, 2)
    assert.equal(uploads[0].key, uploads[1].key)
    assert.equal(uploads[0].body.contentType, 'image/jpeg')
    assert.ok(
      calls.find((c) => c.path.endsWith('/content')).auth.startsWith('Bearer '),
    )
    await page.goto(base + '/mobile/records/new?elder=ELDER-two')
    await page
      .getByRole('region', { name: '照片辅助观察', exact: true })
      .waitFor()
    assert.equal(await region.locator('img').count(), 0)
    assert.equal(await region.getByText(/人工修正的虚构观察/).count(), 0)
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await noOverflow(page)
    }
    await page.screenshot({
      path: resolve(output, 'mobile-photo.png'),
      fullPage: true,
    })
  })
  await test(
    '主管恢复人工编辑内容、审核失败锁定及重试后保留正式记录回执',
    async ({ page, state, writes }) => {
      state.photos = [photo]
      state.analysis.status = 'pending_management'
      state.analysis.reviews = [
        {
          decision: 'request_management',
          observations: ['护理员人工修正观察'],
          note: '请主管核对',
        },
      ]
      await page.goto(
        base +
          '/admin/workflows/records?elder_id=ELDER-one&analysis_id=IMAGE-one&action=%2Frecords%2Fmanual',
      )
      const region = page.getByRole('region', {
        name: '照片辅助观察',
        exact: true,
      })
      await region.getByLabel('人工核对观察').waitFor()
      assert.equal(
        await region.getByLabel('人工核对观察').inputValue(),
        '护理员人工修正观察',
      )
      await region.getByLabel('核对说明').fill('主管人工确认')
      state.failReview = true
      await region
        .getByRole('button', { name: '主管核对并保存正式记录', exact: true })
        .click()
      await region.getByText(/审核结果待核实/).waitFor()
      assert.ok(await region.getByLabel('人工核对观察').isDisabled())
      state.failReview = false
      await region
        .getByRole('button', { name: '主管核对并保存正式记录', exact: true })
        .click()
      await region
        .getByText('人工确认记录已创建：REC-photo', { exact: true })
        .waitFor()
      assert.equal(writes[0].key, writes[1].key)
      assert.deepEqual(writes[0].body, writes[1].body)
      assert.ok(
        !writes.some(
          (w) => w.path === '/records/manual' || /\/link$/.test(w.path),
        ),
      )
      await noOverflow(page)
    },
    'supervisor',
  )
  await test('视觉未配置时可上传但不可启动识别', async ({ page, state }) => {
    state.configured = false
    state.photos = [photo]
    await page.goto(
      base + '/mobile/records/new?elder=ELDER-one&attachment_id=PHOTO-one',
    )
    await page
      .getByRole('button', { name: '视觉服务未配置', exact: true })
      .waitFor()
    assert.ok(
      await page
        .getByRole('button', { name: '视觉服务未配置', exact: true })
        .isDisabled(),
    )
  })
  await test('识别刷新恢复不重复启动，切换老人后停止旧照片轮询', async ({
    page,
    state,
    calls,
    writes,
  }) => {
    state.photos = [photo]
    state.analysis.status = 'processing'
    state.analysis.model_status = 'processing'
    state.analysis.output = null
    await page.goto(
      base + '/mobile/records/new?elder=ELDER-one&attachment_id=PHOTO-one',
    )
    await page
      .getByRole('button', { name: '整理可见观察', exact: true })
      .click()
    await page.waitForFunction(() =>
      Object.keys(sessionStorage).some(
        (key) =>
          key.startsWith('hulao:photo-requests:') &&
          JSON.parse(sessionStorage.getItem(key)).analyze?.id,
      ),
    )
    state.analysis = structuredClone(analysis)
    await page.reload()
    await page
      .getByRole('button', { name: '提交主管审核', exact: true })
      .waitFor()
    assert.equal(
      writes.filter((write) => write.path.endsWith('/analyze')).length,
      1,
    )
    state.analysis.status = 'processing'
    state.analysis.model_status = 'processing'
    state.analysis.output = null
    await page
      .getByRole('button', { name: '核实服务器识别与审核状态', exact: true })
      .click()
    await page.getByText('照片状态：识别中', { exact: false }).waitFor()
    await page.goto(base + '/mobile/records/new?elder=ELDER-two')
    await page
      .getByRole('region', { name: '照片辅助观察', exact: true })
      .waitFor()
    const before = calls.filter(
      (call) => call.path === '/attachments/analyses/IMAGE-one',
    ).length
    await page.waitForTimeout(2300)
    assert.equal(
      calls.filter((call) => call.path === '/attachments/analyses/IMAGE-one')
        .length,
      before,
    )
    assert.equal(await page.locator('.photo-review img').count(), 0)
  })
  await test('损坏的照片请求日志暂停写入并明确提示', async ({
    page,
    writes,
  }) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-one')
    await page.waitForFunction(
      () =>
        document.querySelector('.photo-form input[type="file"]')?.disabled ===
        false,
    )
    await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('hulao:session:v2'))
      sessionStorage.setItem(
        'hulao:photo-requests:v1:' +
          JSON.stringify([
            session.mode,
            session.accountKey,
            session.userId,
            session.role,
            'ELDER-one',
          ]),
        'null',
      )
    })
    await page.reload()
    await page.getByText(/本机照片请求恢复日志无法读取/).waitFor()
    assert.ok(await page.getByLabel('拍照或选择照片').isDisabled())
    assert.equal(writes.length, 0)
  })
  await test(
    '正式记录鉴权查看原图和审核，无再次提交入口，撤权清除旧图',
    async ({ page, state, calls, writes }) => {
      state.photoRecord = true
      state.photos = [photo]
      state.analysis.status = 'confirmed'
      state.analysis.record_id = 'REC-photo'
      state.analysis.reviews = [
        {
          decision: 'confirm',
          observations: ['人工确认观察'],
          note: '主管核对说明',
        },
      ]
      await page.goto(
        base +
          '/admin/workflows/records?elder_id=ELDER-one&action=%2Frecords&read=1',
      )
      await page
        .getByRole('button', { name: '查看原图与人工审核', exact: true })
        .click()
      const region = page.getByRole('region', {
        name: '照片辅助观察',
        exact: true,
      })
      await region
        .getByText('审核说明：主管核对说明', { exact: true })
        .waitFor()
      await region
        .getByText('人工核对观察：人工确认观察', { exact: true })
        .waitFor()
      assert.equal(await region.locator('input,textarea').count(), 0)
      assert.ok(
        calls
          .find((call) => call.path.endsWith('/content'))
          .auth.startsWith('Bearer '),
      )
      assert.equal(writes.length, 0)
      state.denyPhotos = true
      await region
        .getByRole('button', { name: '核实服务器识别与审核状态', exact: true })
        .click()
      await region.getByRole('alert').waitFor()
      assert.equal(await region.locator('img').count(), 0)
    },
    'supervisor',
  )
  await test(
    '完整看板单快照、筛选、明细跳转和尺寸检查',
    async ({ page, calls }) => {
      await page.goto(base + '/admin/dashboard')
      await page
        .getByRole('heading', { name: '任务状态总览', exact: true })
        .waitFor()
      await page.locator('.metric').filter({ hasText: '待执行任务' }).click()
      assert.equal(await page.locator('.drilldown li').count(), 2)
      await page.getByLabel('老人', { exact: true }).selectOption('ELDER-one')
      await page.getByRole('button', { name: '应用筛选', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('.drilldown li').length === 1,
      )
      assert.ok(
        !calls.some(
          (c) => c.path === '/reports/metrics' || c.path === '/tasks',
        ),
      )
      for (const width of [320, 390, 430, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 })
        await noOverflow(page)
      }
      await page.setViewportSize({ width: 1366, height: 900 })
      await page.screenshot({
        path: resolve(output, 'admin-dashboard.png'),
        fullPage: true,
      })
      await page
        .locator('.drilldown')
        .getByRole('link', { name: '查看对象', exact: true })
        .click()
      await page.waitForURL(/task=TASK-1/)
    },
    'admin',
  )
  await test(
    '看板拒绝异常快照，重试恢复且撤权清空',
    async ({ page, state }) => {
      state.failDashboard = true
      await page.goto(base + '/admin/dashboard')
      await page.getByRole('button', { name: '重试', exact: true }).waitFor()
      state.failDashboard = false
      state.invalidDashboard = true
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page
        .getByText('管理看板数据格式异常，请刷新后联系管理员。', {
          exact: true,
        })
        .waitFor()
      state.invalidDashboard = false
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page
        .getByRole('heading', { name: '任务状态总览', exact: true })
        .waitFor()
      state.emptyDashboard = true
      await page
        .getByRole('button', { name: '刷新完整看板', exact: true })
        .click()
      await page
        .getByText('当前筛选下暂无待处理事项。', { exact: true })
        .waitFor()
      assert.deepEqual(await page.locator('.metric strong').allTextContents(), [
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ])
      await page.evaluate(() =>
        window.dispatchEvent(new Event('hulao:unauthorized')),
      )
      assert.equal(await page.locator('.metric').count(), 0)
    },
    'admin',
  )
  await test(
    '主管创建及撤销照护分配，使用响应版本',
    async ({ page, writes }) => {
      await page.goto(base + '/admin/elders')
      const panel = page.getByRole('region', {
        name: '照护范围安排',
        exact: true,
      })
      await panel.getByLabel('老人', { exact: true }).selectOption('ELDER-one')
      await panel.getByLabel('护理员', { exact: true }).selectOption('USER-one')
      await panel.getByLabel('安排原因', { exact: true }).fill('虚构支援安排')
      await panel
        .getByRole('button', { name: '创建照护分配', exact: true })
        .click()
      await panel.getByText(/分配已由服务器确认/).waitFor()
      page.once('dialog', (dialog) => dialog.accept())
      await panel.getByRole('button', { name: '撤销', exact: true }).click()
      await panel.getByText(/已撤销，服务器版本 2/).waitFor()
      assert.equal(writes[1].body.expected_revision, 1)
      assert.ok(writes.every((w) => w.key))
      await noOverflow(page)
    },
    'supervisor',
  )
  await test(
    '照护安排失败刷新后锁定原内容并复用原请求',
    async ({ page, state, writes }) => {
      state.failAssignment = true
      await page.goto(base + '/admin/elders')
      const panel = page.getByRole('region', {
        name: '照护范围安排',
        exact: true,
      })
      await panel.getByLabel('老人', { exact: true }).selectOption('ELDER-one')
      await panel.getByLabel('护理员', { exact: true }).selectOption('USER-one')
      await panel.getByLabel('安排原因', { exact: true }).fill('虚构原始安排')
      await panel
        .getByRole('button', { name: '创建照护分配', exact: true })
        .click()
      await panel.getByText(/存在结果待核实的请求/).waitFor()
      state.failAssignment = false
      await page.reload()
      await panel
        .getByRole('button', { name: '使用同一请求编号重试', exact: true })
        .waitFor()
      assert.ok(
        await panel.getByLabel('安排原因', { exact: true }).isDisabled(),
      )
      await panel
        .getByRole('button', { name: '使用同一请求编号重试', exact: true })
        .click()
      await panel.getByText(/分配已由服务器确认/).waitFor()
      assert.equal(writes.length, 2)
      assert.equal(writes[0].key, writes[1].key)
      assert.deepEqual(writes[0].body, writes[1].body)
    },
    'supervisor',
  )
  await test(
    '家属不能进入内部通知、安全或私有照片流程',
    async ({ page, calls }) => {
      for (const path of [
        '/mobile/safety?report=1',
        '/mobile/notifications',
        '/mobile/records/new?elder=ELDER-one&analysis_id=IMAGE-one',
      ]) {
        await page.goto(base + path)
        await page.waitForURL(/\/(403|family)$/)
      }
      assert.ok(
        !calls.some((c) => /attachments|notifications|incidents/.test(c.path)),
      )
    },
    'family',
  )
} finally {
  await browser.close()
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ results, runtimeErrors: errors }, null, 2),
  )
}
if (results.some((row) => !row.passed) || errors.length) process.exitCode = 1

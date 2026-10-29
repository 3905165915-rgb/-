// Isolated browser regression: all business API requests are intercepted.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5188'
const output = 'test-results/safety-flow'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const stamp = '2026-10-28T08:00:00Z'
const elder = {
  id: 'ELDER-test',
  name: '虚构测试老人',
  status: 'active',
  revision: 1,
  current_admission_id: 'ADM-test',
}
const incident = {
  id: 'INCIDENT-test',
  elder_id: elder.id,
  admission_id: 'ADM-test',
  status: 'reported',
  revision: 1,
  occurred_at: stamp,
  description: '发现地面湿滑，老人已离开该区域',
  immediate_action: '已扶老人至安全位置并通知现场人员',
  evidence: [],
  created_by: 'USER-test',
  created_at: stamp,
  rectification: null,
}
const notice = {
  id: 'NOTICE-test',
  object_type: 'incidents',
  object_id: incident.id,
  elder_id: elder.id,
  title: '紧急安全事件 · 待查看与分级',
  stage: 'triage',
  status: 'pending',
  revision: 1,
  created_at: stamp,
  read_at: stamp,
  priority: 'urgent',
}
const errors = []
const field = (page, key) =>
  page
    .locator(`[data-field="填写办理内容.${key}"]`)
    .locator('input,textarea,select')
    .first()
async function setup(role, width = 1366) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(
    (role) =>
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          mode: 'api',
          accountKey: 'synthetic-' + role,
          role,
          userId: 'USER-test',
          accessToken: 'synthetic-test-token',
        }),
      ),
    role,
  )
  const writes = []
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api/v1', '')
    const json = (data) => route.fulfill({ json: data })
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postDataJSON() })
      if (path === '/incidents')
        return route.fulfill({ status: 201, json: incident })
      if (path === '/insights/coverage/reviews')
        return json({ id: 'REVIEW-test', decision: 'needs_followup' })
      throw new Error('Unexpected write: ' + path)
    }
    if (path === '/notifications')
      return json({
        items: [notice],
        total: 1,
        urgent_total: 1,
        offset: Number(url.searchParams.get('offset') || 0),
        limit: Number(url.searchParams.get('limit') || 100),
        as_of: stamp,
        definition: '已读后保留待处理状态',
      })
    if (path === '/elders') return json([elder])
    if (path === '/elders/' + elder.id + '/admissions')
      return json([{ id: 'ADM-test', elder_id: elder.id, status: 'active' }])
    if (path === '/incidents') return json([incident])
    if (path === '/incidents/' + incident.id) return json(incident)
    if (path === '/staff' || path === '/staff/directory')
      return json([
        { id: 'USER-test', display_name: '虚构测试人员', role, active: true },
      ])
    if (path === '/insights/coverage')
      return json({
        elder_id: elder.id,
        service_date: '2026-10-28',
        items: [
          {
            occurrence_key: 'OCC-test',
            fingerprint: 'a'.repeat(64),
            title: '午间饮水',
            status: 'missing',
            elder_id: elder.id,
          },
        ],
      })
    return json([])
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (e) => errors.push(e.message))
  return { context, page, writes }
}
async function shot(page, name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    ),
    false,
    'horizontal overflow',
  )
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
}
try {
  for (const role of ['admin', 'supervisor']) {
    const { context, page, writes } = await setup(role)
    try {
      await page.goto(base + '/admin/workflows/incidents')
      await page
        .getByRole('heading', { name: '安全事件处置', exact: true })
        .waitFor()
      await page.locator('.safety-alert-bar').waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: '紧急上报安全事件', exact: true })
          .count(),
        0,
      )
      await page.locator('.safety-alert-bar a').click()
      await page
        .locator('.wf-incident-facts')
        .filter({ hasText: incident.description })
        .waitFor()
      await page.locator('[aria-label="事件后续操作"] button').first().waitFor()
      assert.equal(writes.length, 0)
      await shot(page, role + '-detail')
      await page.setViewportSize({ width: 390, height: 844 })
      await shot(page, role + '-detail-phone')
      await page.locator('[aria-label="事件后续操作"] button').first().click()
      assert.equal(await page.locator('[data-field="incident_id"] select').inputValue(), incident.id)
      assert.equal(await field(page, 'expected_revision').inputValue(), '1')
      assert.equal(writes.length, 0)
      console.log(
        'PASS ' +
          role +
          ': urgent notification opens details, no report control',
      )
    } finally {
      await context.close()
    }
  }
  for (const role of ['caregiver', 'nurse']) {
    const { context, page, writes } = await setup(role, 390)
    try {
      await page.goto(base + '/mobile/safety')
      await page
        .getByRole('heading', { name: '紧急上报安全事件', exact: true })
        .waitFor()
      await field(page, 'elder_id').selectOption(elder.id)
      assert.equal(await field(page, 'admission_id').inputValue(), 'ADM-test')
      await field(page, 'occurred_at').fill('2026-10-28T16:00')
      await field(page, 'description').fill(incident.description)
      await field(page, 'immediate_action').fill(incident.immediate_action)
      await shot(page, role + '-report')
      // Form selection and input must never submit an incident.
      assert.equal(writes.length, 0)
      await page.locator('form button[type="submit"]').click()
      assert.equal(writes.length, 0)
      await page.getByRole('button', { name: '确认提交', exact: true }).click()
      await page.getByText('本次操作已完成', { exact: true }).first().waitFor()
      assert.equal(writes[0].path, '/incidents')
      assert.equal(writes[0].body.admission_id, 'ADM-test')
      assert.deepEqual(writes[0].body.evidence, [])
      console.log(
        'PASS ' +
          role +
          ': direct report form, admission autofilled, report without AI or record',
      )
    } finally {
      await context.close()
    }
  }
  {
    const { context, page, writes } = await setup('admin')
    try {
      await page.goto(base + '/admin/coverage')
      await page
        .locator(
          '[data-field="service_date"] input, [data-field$=".service_date"] input',
        )
        .first()
        .fill('2026-10-28')
      await page
        .locator(
          '[data-field="elder_id"] select, [data-field$=".elder_id"] select',
        )
        .first()
        .selectOption(elder.id)
      await page.locator('form button[type="submit"]').first().click()
      await page
        .getByRole('button', { name: '核对并处理此项', exact: true })
        .click()
      await field(page, 'decision').waitFor()
      assert.equal(await field(page, 'occurrence_key').count(), 0)
      assert.equal(await field(page, 'expected_fingerprint').count(), 0)
      assert.ok(
        await page
          .locator('.wf-form')
          .first()
          .innerText()
          .then(
            (text) => text.includes('2026-10-28') && text.includes(elder.name),
          ),
      )
      assert.equal(writes.length, 0)
      await shot(page, 'coverage-direct-review')
      await field(page, 'decision').selectOption('needs_followup')
      await field(page, 'note').fill('已核对，安排当班人员跟进饮水情况')
      await page.locator('form button[type="submit"]').first().click()
      assert.equal(writes.length, 0)
      await page.getByRole('button', { name: '确认提交', exact: true }).click()
      await page.getByText('本次操作已完成', { exact: true }).first().waitFor()
      assert.deepEqual(writes[0], {
        path: '/insights/coverage/reviews',
        body: {
          elder_id: elder.id,
          service_date: '2026-10-28',
          occurrence_key: 'OCC-test',
          expected_fingerprint: 'a'.repeat(64),
          decision: 'needs_followup',
          note: '已核对，安排当班人员跟进饮水情况',
        },
      })
      await page.getByRole('button', { name: '查看更新后的核对结果', exact: true }).click()
      assert.equal(await page.locator('[data-field="service_date"] input').first().inputValue(), '2026-10-28')
      assert.equal(await page.locator('[data-field="elder_id"] select').first().inputValue(), elder.id)
      console.log('PASS coverage: direct form, complete payload on confirmation, same context after return')
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

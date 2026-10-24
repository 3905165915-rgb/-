import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5176'
const out = 'test-results/impressions'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = [],
  errors = []
const report = () => ({
  id: 'IMP-test',
  elder_id: 'E1',
  created_at: '2026-10-24T01:00:00Z',
  review_due_at: '2026-11-23T01:00:00Z',
  model_status: 'available',
  source_current: true,
  review_due: false,
  new_record_count: 0,
  coverage: {
    record_count: 84,
    simulated_count: 84,
    from: '2026-07-27T06:00:00Z',
    to: '2026-10-18T06:00:00Z',
    batch_count: 4,
  },
  sources: [
    {
      source_id: 'R1',
      revision: 1,
      happened_at: '2026-07-27T06:00:00Z',
      recorded_at: '2026-10-24T01:00:00Z',
      text: '模拟：喜欢午后听吕剧',
      simulated: true,
    },
  ],
  points: [
    {
      id: 'point-1',
      category: 'preference',
      kind: 'observation',
      expressor: 'elder',
      text: '午后喜欢听吕剧，仍需询问当次意愿',
      status: 'candidate',
      revision: 1,
      supporting_days: 1,
      supporting_records: 1,
      citations: [{ source_id: 'R1', quote: '喜欢午后听吕剧' }],
      reviewed_at: null,
      reviewed_by_name: null,
      review_note: null,
    },
  ],
})
async function test(name, role, fn) {
  const context = await browser.newContext({
    viewport:
      role === 'caregiver'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
  })
  const state = { report: null, writes: [], stale: false, invalid: false, promote: false }
  await context.addInitScript(
    (role) =>
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          mode: 'api',
          accountKey: 'impressions-' + role,
          userId: 'user',
          role,
          accessToken: 'isolated-not-real',
        }),
      ),
    role,
  )
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/v1', '')
    let data = []
    if (path === '/elders')
      data = [{ id: 'E1', name: '张阿姨', status: 'active', revision: 1 }]
    if (path === '/elders/E1/impressions')
      data = {
        latest: state.report,
        history: state.report
          ? [
              {
                id: 'IMP-test',
                created_at: state.report.created_at,
                record_count: 84,
              },
            ]
          : [],
      }
    if (req.method() === 'POST') {
      state.writes.push({
        path,
        body: req.postData() ? req.postDataJSON() : undefined,
      })
      if (path.endsWith('/generate')) {
        state.report = report()
        if (state.promote) state.report.points[0].kind = 'trend'
        state.report.source_current = !state.stale
        if (state.invalid)
          state.report.points[0].citations[0].quote = '错误证据不能显示'
        data = state.report
      } else if (path.endsWith('/activate-memory')) {
        state.report.points[0].care_memory = {id: 'MEM-test', status: 'confirmed', effective: true}
        data = {id: 'MEM-test', elder_id: 'E1', status: 'confirmed', effective: true}
      } else if (path.endsWith('/review')) {
        state.report.points[0] = {
          ...state.report.points[0],
          status: req.postDataJSON().decision,
          revision: 2,
          reviewed_at: '2026-10-24T02:00:00Z',
          reviewed_by_name: '护理主管',
          review_note: req.postDataJSON().note,
        }
        data = state.report
      }
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(data),
    })
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(
      base + (role === 'caregiver' ? '/mobile' : '/admin') + '/elders/E1',
    )
    await page.getByRole('heading', { name: '老人印象', exact: true }).waitFor()
    await fn({ page, state })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    )
    await page.screenshot({
      path: out + '/' + results.length + '.png',
      fullPage: true,
    })
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (e) {
    results.push({ name, passed: false, error: e.stack })
    console.error('FAIL ' + name + ': ' + e.message)
    await page.screenshot({
      path: out + '/failure-' + results.length + '.png',
      fullPage: true,
    })
  } finally {
    await context.close()
  }
}
try {
  await test('主管明确场景后将已核对印象加入记忆，刷新不重复创建', 'admin', async ({page, state}) => {
    state.promote = true
    await page.getByRole('button', {name: '整理老人印象', exact: true}).click()
    await page.getByRole('button', {name: '核对这条印象', exact: true}).click()
    await page.getByLabel('核对说明（例如已与本人核实、仅适用的时段）').fill('虚构验收：已向本人核实')
    await page.getByRole('button', {name: '确认已核对', exact: true}).click()
    await page.getByRole('button', {name: '加入照护记忆', exact: true}).click()
    await page.getByLabel('活动', {exact: true}).check()
    await page.getByLabel('确认依据及适用限制', {exact: true}).fill('虚构：本人仍愿意听戏，每次活动前询问')
    await page.getByRole('button', {name: '确认加入并用于场景提示', exact: true}).click()
    await page.getByText('已加入照护记忆。可在对应场景查看。', {exact: true}).waitFor()
    assert.equal(state.writes.length, 3)
    assert.deepEqual(state.writes[2].body.scenes, ['activity'])
    assert.equal(state.writes[2].body.source_revision, 1)
    await page.reload()
    await page.getByText('已加入照护记忆。可在对应场景查看。', {exact: true}).waitFor()
    assert.equal(await page.getByRole('button', {name: '加入照护记忆', exact: true}).count(), 0)
  })
  await test(
    '管理端：长期印象、原文和人工核对闭环',
    'admin',
    async ({ page, state }) => {
      await page
        .getByRole('button', { name: '整理老人印象', exact: true })
        .click()
      await page
        .getByText('午后喜欢听吕剧，仍需询问当次意愿', { exact: true })
        .waitFor()
      await page.getByText('查看原文依据（1）', { exact: true }).click()
      await page.getByText('喜欢午后听吕剧', { exact: true }).waitFor()
      assert.match(
        await page.locator('.elder-impression').innerText(),
        /84 条虚构演示记录/,
      )
      await page
        .getByRole('button', { name: '核对这条印象', exact: true })
        .click()
      await page
        .getByLabel('核对说明（例如已与本人核实、仅适用的时段）')
        .fill('虚构演示：已核对原文，实际仍逐次询问')
      await page
        .getByRole('button', { name: '确认已核对', exact: true })
        .click()
      await page.getByText('已人工核对', { exact: true }).waitFor()
      assert.equal(state.writes.length, 2)
      assert.equal(state.writes[1].body.expected_revision, 1)
    },
  )
  await test(
    '护理手机：可阅读和整理、不能代主管确认、布局无溢出',
    'caregiver',
    async ({ page }) => {
      await page
        .getByRole('button', { name: '整理老人印象', exact: true })
        .click()
      await page
        .getByText('午后喜欢听吕剧，仍需询问当次意愿', { exact: true })
        .waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: '核对这条印象', exact: true })
          .count(),
        0,
      )
    },
  )
  await test(
    '来源变化：显示重新整理提醒并阻止确认',
    'admin',
    async ({ page, state }) => {
      state.stale = true
      await page
        .getByRole('button', { name: '整理老人印象', exact: true })
        .click()
      await page.getByText(/本版需重新整理，暂不能确认/).waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: '核对这条印象', exact: true })
          .count(),
        0,
      )
    },
  )
  await test(
    '引用异常：拒绝渲染为有效印象',
    'admin',
    async ({ page, state }) => {
      state.invalid = true
      await page
        .getByRole('button', { name: '整理老人印象', exact: true })
        .click()
      await page
        .getByRole('alert')
        .filter({ hasText: '返回格式异常' })
        .waitFor()
      assert.equal(await page.locator('.impression-point').count(), 0)
    },
  )
} finally {
  await browser.close()
  await writeFile(
    out + '/report.json',
    JSON.stringify({ results, runtimeErrors: errors }, null, 2),
  )
}
if (errors.length || results.some((r) => !r.passed)) process.exitCode = 1

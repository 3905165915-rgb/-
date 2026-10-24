import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WORKFLOW_URL || 'http://127.0.0.1:5177'
const output = 'test-results/personal-care'
await mkdir(output, {recursive: true})
const browser = await chromium.launch({headless: true, channel: 'msedge'})
const results = [], errors = []
const stamp = '2026-10-24T01:00:00Z'
const elder = {id: 'ELDER-test', name: '张阿姨', status: 'active', revision: 1}
const record = {id: 'REC-test', elder_id: elder.id, raw_text: '午后喜欢听吕剧', observations: ['午后喜欢听吕剧'], revision: 2, status: 'corrected', created_at: stamp, created_by: 'USER-test'}
const source = {record_id: record.id, revision: 2, field: 'observations', quote: record.observations[0], snapshot_text: record.observations[0], record_status: 'corrected', captured_at: stamp}
const memory = {id: 'MEM-test', elder_id: elder.id, revision: 2, status: 'confirmed', content: '活动前询问是否愿意听吕剧', category: 'stable_preference', scenes: ['activity'], attributed_to: 'elder', source, valid_from: stamp, expires_at: null, review_due_at: null, confirmed_by: 'USER-test', confirmed_at: stamp, created_by: 'USER-test', created_at: stamp, updated_at: stamp, effective: true, source_current: true, review_due: false, blocked_reasons: []}
const field = (page, key) => page.locator(`[data-field="填写办理内容.${key}"]`).locator('input,textarea,select').first()

async function test(name, fn) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}})
  await context.addInitScript(() => sessionStorage.setItem('hulao:session:v2', JSON.stringify({mode: 'api', accountKey: 'care-test', userId: 'USER-test', role: 'admin', accessToken: 'synthetic-isolated-token'})))
  const state = { hold: false, release: () => {}, writes: [] }
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', '')
    if (req.method() !== 'GET') {
      state.writes.push({path, body: req.postDataJSON()})
      state.hold = true
      return route.fulfill({contentType: 'application/json', status: 201, body: JSON.stringify({record, tasks: []})})
    }
    if (state.hold && path === '/records') await new Promise(resolve => {state.release = resolve})
    const data = path === '/elders' ? [elder, {id: 'ELDER-other', name: '李爷爷', status: 'active', revision: 1}]
      : path === '/records' ? [record, {...record, id: 'REC-other', elder_id: 'ELDER-other', observations: ['另一个老人记录']}]
      : path === '/staff' || path === '/staff/directory' ? [{id: 'USER-test', display_name: '护理员', role: 'caregiver'}]
      : path === '/memories/context' ? {elder_id: elder.id, scene: new URL(req.url()).searchParams.get('scene'), as_of: stamp, memories: new URL(req.url()).searchParams.get('scene') === 'activity' ? [memory] : []}
      : []
    await route.fulfill({contentType: 'application/json', body: JSON.stringify(data)})
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  try {
    await fn({page, state})
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false)
    await page.screenshot({path: `${output}/${results.length}.png`, fullPage: true})
    results.push({name, passed: true}); console.log('PASS ' + name)
  } catch(e) {
    results.push({name, passed: false, error: e.stack, body: await page.locator('body').innerText()}); console.error('FAIL ' + name + ': ' + e.message)
    await page.screenshot({path: `${output}/failure-${results.length}.png`, fullPage: true})
  } finally { state.release(); await context.close() }
}
try {
  await test('手机记录：场景提示不等待模型；切换场景不沿用旧提示', async ({page}) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await field(page, 'scene').selectOption('activity')
    await page.getByText(memory.content, {exact: true}).waitFor()
    await field(page, 'scene').selectOption('dining')
    await page.getByText('当前场景还没有有效的个性化记忆，请以本人当次意愿和正式计划为准。', {exact: true}).waitFor()
    assert.equal(await page.getByText(memory.content, {exact: true}).count(), 0)
  })
  await test('正式保存即时回执，目录刷新被阻塞也不显示保存中', async ({page, state}) => {
    await page.goto(base + '/mobile/records/new?elder=ELDER-test')
    await page.getByRole('button', {name: '直接填写', exact: true}).click()
    await field(page, 'raw_text').fill('虚构验收：今天午后愿意听戏')
    await page.getByRole('button', {name: '添加已核对观察', exact: true}).click()
    await field(page, 'observations.0').fill('今天午后愿意听戏')
    await page.getByRole('button', {name: '核对并继续', exact: true}).click()
    await page.getByRole('button', {name: '仅保存记录', exact: true}).click()
    await page.getByText('记录已保存，本次未创建任务。', {exact: true}).waitFor()
    await page.getByRole('button', {name: '本次操作已完成', exact: true}).waitFor()
    assert.equal(state.writes.length, 1)
    assert.equal(state.writes[0].path, '/records/manual')
    assert.equal(await page.getByText('正在保存…', {exact: true}).count(), 0)
    state.hold = false; state.release()
  })
  await test('记忆来源：只选本老人记录、版本自动绑定、原文可选择', async ({page}) => {
    await page.goto(base + '/admin/workflows/memories?elder_id=ELDER-test')
    await field(page, 'source_record_id').waitFor()
    assert.equal(await field(page, 'source_record_id').locator('option[value="REC-other"]').count(), 0)
    await field(page, 'source_record_id').selectOption('REC-test')
    await page.getByText('已自动关联当前记录版本，无需填写版本号。请选择支持本条记忆的原文。', {exact: true}).waitFor()
    await field(page, 'source_quote').selectOption(record.observations[0])
    assert.equal(await page.locator('[data-field="填写办理内容.source_revision"] input').count(), 0)
  })
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify({results, runtimeErrors: errors}, null, 2))
}
if (errors.length || results.some(r => !r.passed)) process.exitCode = 1

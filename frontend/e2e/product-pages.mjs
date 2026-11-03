import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Real HTTP integration, exclusively against the isolated local synthetic server.
const base = process.env.PRODUCT_PAGES_URL || 'http://127.0.0.1:5231'
const api = process.env.PRODUCT_PAGES_API || 'http://127.0.0.1:8769/api/v1'
for (const address of [base, api]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(address).hostname), 'This test may only use a local synthetic server')
const output = 'test-results/product-pages'
await mkdir(output, { recursive: true })
const health = await (await fetch(api + '/health')).json()
assert.ok(['test', 'development'].includes(health.environment), 'Requires an isolated test/development server')
async function login(username) {
  const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'family-browser-test' }) })
  assert.equal(response.status, 200, 'Synthetic account login failed: ' + username)
  return response.json()
}
const admin = await login('admin'), nurse = await login(process.env.PRODUCT_PAGES_NURSE || 'nurse')
async function apiCall(path, account = admin, payload) {
  const response = await fetch(api + path, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + account.access_token, ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
  const value = await response.json()
  assert.ok(response.ok, path + ' returned ' + response.status + ': ' + (value.safe_message || value.error_code || 'unexpected response'))
  return value
}
const suffix = Date.now().toString(36)
const staffElders = await apiCall('/elders', nurse)
const reportingElder = staffElders.find(row => row.current_admission_id)
assert.ok(reportingElder, 'Requires a synthetic elder assigned to the caregiver')
const incident = await apiCall('/incidents', nurse, { elder_id: reportingElder.id, admission_id: reportingElder.current_admission_id, occurred_at: new Date(Date.now() - 60000).toISOString(), description: '合成页面联调：活动时失去平衡，已协助坐稳 ' + suffix, immediate_action: '合成测试：已通知现场人员并陪同观察。', evidence: [] })
const bed = await apiCall('/beds', admin, { room: '页面联调房' + suffix, label: '合成空床' + suffix })
const plans = await apiCall('/care-plans')
const plan = plans.find(row => row.status === 'active')
assert.ok(plan, 'Requires a synthetic approved plan')
const shifts = await apiCall('/shifts')
const currentShift = shifts.find(row => row.status === 'open' && Date.parse(row.start_at) <= Date.now() && Date.parse(row.end_at) > Date.now())
assert.ok(currentShift, 'Requires a current synthetic shift')
const staff = await apiCall('/staff')
const person = staff.find(row => currentShift.caregiver_ids.includes(row.id))
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path))
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const results = [], errors = []
async function open(width, account, app) {
  const context = await browser.newContext({ viewport: { width, height: app === 'mobile' ? 844 : 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(account => sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'synthetic-product-pages-' + account.user_id, userId: account.user_id, role: account.role, accessToken: account.access_token })), account)
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  return { context, page }
}
async function capture(page, name) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }))
  assert.ok(size.page <= size.viewport + 1, 'Horizontal overflow: ' + name + ' ' + JSON.stringify(size))
  await page.screenshot({ path: output + '/' + name + '.png', fullPage: true })
  results.push({ name, passed: true, viewport: size.viewport })
}
async function choose(page, holder, value, text) {
  const native = holder.locator('select')
  if (await native.count()) return native.first().selectOption(value)
  await holder.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: text }).first().click()
}
async function serviceDate(page, holder) {
  const native = holder.locator('input[type=date]')
  if (await native.count()) return native.fill(day)
  await holder.locator('.care-date-trigger').click()
  const [year, month, date] = day.split('-').map(Number)
  await page.getByRole('dialog').getByRole('button', { name: `${year}年${month}月${date}日`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
}
try {
  for (const width of [1280, 1440]) {
    const { context, page } = await open(width, admin, 'admin')
    try {
      await page.goto(base + '/admin/workflows/incidents?incident_id=' + encodeURIComponent(incident.id) + '&read=1')
      await page.locator('.wf-incident-detail').waitFor()
      assert.ok((await page.locator('.wf-incident-detail h3').first().textContent()).includes('活动时失去平衡'))
      await page.getByRole('button', { name: '分级并安排整改', exact: true }).click()
      await page.locator('[data-field="body.category"]').waitFor()
      await capture(page, 'incident-next-step-' + width)
      await page.getByRole('button', { name: '返回事件清单', exact: true }).click()
      await page.locator('.wf-result-item').filter({ hasText: incident.description }).first().waitFor()
      assert.equal(await page.locator('.wf-menu').count(), 0, 'Routine incident navigation should not expose API-operation menus')
      await page.locator('.wf-result-item').filter({ hasText: incident.description }).first().getByRole('button', { name: '查看事件详情', exact: true }).click()
      await page.locator('.wf-incident-detail').waitFor()
      await capture(page, 'incident-list-navigation-' + width)
      await page.goto(base + '/admin/admission')
      await page.locator('.admission-journey').waitFor()
      await page.getByRole('radio', { name: '首次建档' }).check()
      const name = '合成入住联调' + suffix + '-' + width
      await page.getByLabel('老人姓名', { exact: true }).fill(name)
      const created = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/elders') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '保存档案，继续选择床位' }).click()
      const elderResponse = await created
      assert.equal(elderResponse.status(), 201)
      const elder = await elderResponse.json()
      const targetBed = width === 1280 ? bed : await apiCall('/beds', admin, { room: '页面联调房1440' + suffix, label: '合成空床1440' + suffix })
      if (width === 1440) {
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/beds') && response.request().method() === 'GET')
        await page.getByRole('button', { name: '刷新可用档案与床位', exact: true }).click()
        await refreshed
      }
      await page.getByRole('heading', { name: name + ' · 选择入住床位' }).waitFor()
      await choose(page, page.locator('.admission-journey label').filter({ hasText: '空闲床位' }), targetBed.id, targetBed.label)
      await page.getByLabel('入住说明', { exact: true }).fill('合成联调：已核对老人和床位，测试完整新入住流程。')
      await page.getByRole('button', { name: '核对入住信息', exact: true }).click()
      await capture(page, 'admission-review-' + width)
      const admitted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/elders/' + elder.id + '/admissions') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '确认办理入住', exact: true }).click()
      assert.equal((await admitted).status(), 201)
      await page.getByRole('heading', { name: '入住已完成', exact: true }).waitFor()
      await capture(page, 'admission-complete-' + width)
      await page.goto(base + '/admin/timeline/' + encodeURIComponent(elder.id))
      await page.locator('.item-replay .replay-group').first().waitFor()
      await capture(page, 'timeline-success-' + width)
      await choose(page, page.locator('.replay-filters label').filter({ hasText: '操作类型' }), 'family', '家属沟通')
      await page.getByRole('button', { name: '应用筛选', exact: true }).click()
      await page.getByText('当前筛选范围暂无过程记录。', { exact: true }).waitFor()
      await capture(page, 'timeline-empty-' + width)
      await context.setOffline(true)
      await page.getByRole('button', { name: '刷新过程', exact: true }).click()
      await page.locator('.item-replay [role=alert]').waitFor()
      await capture(page, 'timeline-offline-' + width)
      await context.setOffline(false)
      await page.locator('.item-replay').getByRole('button', { name: '重新读取', exact: true }).click()
      await page.getByText('当前筛选范围暂无过程记录。', { exact: true }).waitFor()
      await page.goto(base + '/admin/workflows/plans?' + new URLSearchParams({ action: '/care-plans/{plan_id}/generate', plan_id: plan.id }))
      await page.locator('[data-field="body.service_date"]').waitFor()
      await serviceDate(page, page.locator('[data-field="body.service_date"]'))
      await choose(page, page.locator('[data-field="body.shift_id"]'), currentShift.id, currentShift.name)
      await choose(page, page.locator('[data-field="body.assigned_to"]'), person.id, person.display_name)
      const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/care-plans/' + plan.id + '/generate-preview'))
      await page.locator('form.wf-form button[type=submit]').click()
      assert.equal((await previewResponse).status(), 200)
      await page.getByRole('region', { name: '服务器任务生成预览' }).waitFor().catch(() => page.locator('.generation-preview').waitFor())
      await capture(page, 'plan-server-preview-' + width)
      await page.locator('.generation-confirm input[type=checkbox]').check()
      const generation = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/care-plans/' + plan.id + '/generate') && response.request().method() === 'POST')
      await page.locator('form.wf-form button[type=submit]').click()
      assert.equal((await generation).status(), 200)
      await page.getByRole('button', { name: '本次操作已完成', exact: true }).waitFor()
      await capture(page, 'plan-generated-' + width)
    } catch (error) { await page.screenshot({ path: output + '/failure-admin-' + width + '.png', fullPage: true }).catch(() => {}); throw error }
    finally { await context.close() }
  }
  for (const width of [320, 390, 430]) {
    const { context, page } = await open(width, nurse, 'mobile')
    try {
      await page.goto(base + '/mobile/safety?incident_id=' + encodeURIComponent(incident.id) + '&read=1')
      await page.locator('.wf-incident-detail').waitFor()
      await capture(page, 'caregiver-incident-' + width)
      await page.goto(base + '/mobile/timeline/' + encodeURIComponent(incident.id))
      await page.locator('.item-replay .replay-group').first().waitFor()
      await capture(page, 'caregiver-timeline-' + width)
    } catch (error) { await page.screenshot({ path: output + '/failure-mobile-' + width + '.png', fullPage: true }).catch(() => {}); throw error }
    finally { await context.close() }
  }
  assert.equal(errors.length, 0, 'Browser runtime errors: ' + errors.join('; '))
  await writeFile(output + '/results.json', JSON.stringify({ results, runtimeErrors: errors, backend: health, frontlineRole: nurse.role }, null, 2))
  console.log(results.length + ' real local browser page checks passed; no horizontal overflow or JavaScript errors.')
} catch (error) {
  await writeFile(output + '/results.json', JSON.stringify({ results, runtimeErrors: errors, failure: error.message }, null, 2))
  throw error
} finally { await browser.close() }

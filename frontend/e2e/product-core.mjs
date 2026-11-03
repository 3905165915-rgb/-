import { chromium, request as apiRequest } from 'playwright'
import { existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const base = process.env.PRODUCT_UI_URL || 'http://127.0.0.1:5231'
if (new URL(base).hostname !== '127.0.0.1') throw new Error('This acceptance run requires a loopback synthetic environment.')
const context = JSON.parse(await readFile(process.env.PRODUCT_UI_CONTEXT || 'C:/Users/Lenovo/Desktop/gptttt/task_tmp/product-ui-context.json', 'utf8'))
const api = await apiRequest.newContext({ baseURL: base + '/api/v1/' })
const output = 'test-results/product-core'
await mkdir(output, { recursive: true })
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const checks = []
const taskTitle = '虚构联调：核对活动安排 ' + crypto.randomUUID().slice(0, 8)
function check(name, condition) { if (!condition) throw new Error(name); checks.push(name) }
async function actor(username, width = 390) {
  const response = await api.post('auth/login', { data: { username, password: 'family-browser-test' } })
  check('real_login_' + username, response.status() === 200)
  const auth = await response.json()
  const browserContext = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Chicago' })
  const page = await browserContext.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(session => sessionStorage.setItem('hulao:session:v2', JSON.stringify(session)), {
    mode: 'api', accountKey: username, userId: auth.user_id, role: auth.role, accessToken: auth.access_token,
  })
  return { page, browserContext, errors, headers: { Authorization: 'Bearer ' + auth.access_token } }
}
async function settled(page) { await page.waitForLoadState('networkidle') }
async function geometry(page, name) {
  check(name + '_no_horizontal_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  check(name + '_no_native_select_or_date', await page.locator('select,input[type=date],input[type=datetime-local],input[type=time]').count() === 0)
}
try {
  const setup = await actor('admin')
  const nurseLogin = await api.post('auth/login', { data: { username: context.nurse_username, password: 'family-browser-test' } })
  const nurseAccount = await nurseLogin.json()
  const sourceResponse = await api.get('tasks/' + context.task_id, { headers: setup.headers })
  const sourceTask = await sourceResponse.json()
  const createdResponse = await api.post('tasks', { headers: { ...setup.headers, 'Idempotency-Key': crypto.randomUUID() }, data: {
    elder_id: context.elder_id, shift_id: sourceTask.shift_id, assigned_to: nurseAccount.user_id,
    title: taskTitle, due_at: new Date(Date.now() + 3600000).toISOString(), completion_criteria: '询问本人意愿并记录结果',
  } })
  check('create_fresh_synthetic_task', createdResponse.status() === 201)
  context.task_id = (await createdResponse.json()).id
  await setup.browserContext.close()
  for (const width of [320, 390, 430, 1280, 1440]) {
    const { page, browserContext, errors } = await actor('manager', width)
    await page.goto(base + '/admin/dashboard'); await settled(page)
    await page.getByRole('heading', { name: '今日工作', exact: true }).waitFor()
    check('dashboard_charts_visible_' + width, await page.getByRole('heading', { name: '照护数据图表', exact: true }).isVisible())
    check('dashboard_task_chart_visible_' + width, await page.getByRole('heading', { name: '任务状态总览', exact: true }).isVisible())
    check('dashboard_plan_trend_visible_' + width, await page.getByRole('heading', { name: '计划服务完成率', exact: true }).isVisible())
    const weeklySnapshot = page.waitForResponse(response => response.url().includes('/api/v1/reports/dashboard?') && response.request().method() === 'GET')
    await page.getByRole('button', { name: '近7天', exact: true }).click()
    check('dashboard_week_filter_real_response_' + width, (await weeklySnapshot).status() === 200)
    await settled(page)
    check('dashboard_seven_daily_columns_' + width, await page.locator('.activity-point').count() === 7)
    check('dashboard_inbox_visible_' + width, await page.getByRole('region', { name: '工作收件箱', exact: true }).isVisible())
    await geometry(page, 'dashboard_' + width)
    await page.screenshot({ path: `${output}/dashboard-${width}.png`, fullPage: true })
    if (width === 1280) await page.locator('.overview-charts').screenshot({ path: `${output}/dashboard-charts-${width}.png` })
    await page.goto(base + '/admin/notifications'); await settled(page)
    const incident = page.locator('.inbox-list>li').filter({ hasText: '虚构联调：走廊发现少量积水' })
    check('one_business_row_for_incident_' + width, await incident.count() === 1)
    await incident.getByRole('button', { name: '立即查看事件', exact: true }).click(); await settled(page)
    check('incident_details_open_' + width, await incident.getByText('虚构联调：走廊发现少量积水，现场已处理', { exact: false }).count() > 0)
    check('incident_real_detail_form_' + width, await incident.locator('.inbox-form').isVisible())
    await geometry(page, 'inbox_' + width)
    check('management_no_browser_errors_' + width, errors.length === 0)
    await browserContext.close()
  }
  for (const width of [320, 390, 430]) {
    const { page, browserContext, errors } = await actor(context.nurse_username, width)
    await page.goto(base + '/mobile/caregiver'); await settled(page)
    const mine = page.getByRole('region', { name: '本人当班任务', exact: true })
    check('nurse_current_task_visible_' + width, await mine.getByText(taskTitle, { exact: true }).count() === 1)
    const urgent = await page.locator('.workbench-safety-link').boundingBox()
    check('urgent_report_in_first_screen_' + width, urgent && urgent.y + urgent.height <= 900)
    await geometry(page, 'caregiver_' + width)
    await page.screenshot({ path: `${output}/caregiver-${width}.png`, fullPage: true })
    await page.goto(base + '/mobile/elders/' + context.elder_id); await settled(page)
    check('elder_workspace_visible_' + width, await page.getByRole('region', { name: '老人照护工作区', exact: true }).isVisible())
    await geometry(page, 'elder_' + width)
    check('nurse_no_browser_errors_' + width, errors.length === 0)
    await browserContext.close()
  }
  const nurse = await actor(context.nurse_username)
  await nurse.page.goto(base + '/mobile/tasks/' + context.task_id); await settled(nurse.page)
  const execution = nurse.page.getByRole('region', { name: '办理当前任务', exact: true })
  await execution.getByRole('button', { name: '开始服务', exact: true }).click(); await settled(nurse.page)
  await execution.getByRole('textbox', { name: '服务结果', exact: true }).fill('合成联调：已询问本人当次意愿，已核对活动安排并记录实际结果。')
  const completeReceipt = nurse.page.waitForResponse(response => response.url().endsWith('/tasks/' + context.task_id + '/complete') && response.request().method() === 'POST')
  await execution.getByRole('button', { name: '提交服务结果', exact: true }).click(); await settled(nurse.page)
  const completedResponse = await completeReceipt
  const task = await api.get('tasks/' + context.task_id, { headers: nurse.headers })
  const taskResult = await task.json()
  if (completedResponse.status() !== 200 || taskResult.status !== 'completed') {
    await nurse.page.screenshot({ path: output + '/task-complete-failure.png', fullPage: true })
    console.log(JSON.stringify({ completeStatus: completedResponse.status(), taskStatus: taskResult.status, alerts: await execution.getByRole('alert').allTextContents() }))
  }
  check('task_completed_via_real_ui_and_api', completedResponse.status() === 200 && task.status() === 200 && taskResult.status === 'completed')
  await nurse.page.goto(base + '/mobile/elders/' + context.elder_id + '?section=records'); await settled(nurse.page)
  const composer = nurse.page.getByRole('region', { name: '快速照护记录', exact: true })
  const recordText = '合成联调：本人愿意参加轻松聊天，已询问本次意愿。' + Date.now()
  await composer.locator('form textarea').fill(recordText)
  const savedResponse = nurse.page.waitForResponse(response => response.url().endsWith('/elders/' + context.elder_id + '/record') && response.request().method() === 'POST')
  await composer.getByRole('button', { name: '保存记录', exact: true }).click()
  const receipt = await savedResponse
  check('record_saved_before_analysis_ui', receipt.status() === 201 && (await receipt.json()).saved === true)
  await settled(nurse.page)
  const recordsResponse = await api.get('records?elder_id=' + context.elder_id, { headers: nurse.headers })
  const records = await recordsResponse.json()
  check('record_written_exactly_once', records.filter(record => record.raw_text === recordText).length === 1)
  await geometry(nurse.page, 'record_mobile')
  check('record_and_task_no_browser_errors', nurse.errors.length === 0)
  await nurse.browserContext.close()
  await writeFile(output + '/result.json', JSON.stringify({ status: 'passed', transport: 'real_local_http', data: 'isolated_synthetic_only', timezone: 'America/Chicago', checks }, null, 2))
  console.log(`${checks.length} product core checks passed with real local HTTP.`)
} finally { await browser.close(); await api.dispose() }

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Read-only route audit against the explicitly isolated synthetic integration server.
const base = process.env.PRODUCT_AUDIT_URL || 'http://127.0.0.1:5231'
const api = process.env.PRODUCT_AUDIT_API || 'http://127.0.0.1:8769/api/v1'
for (const address of [base, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(address).hostname), 'Local synthetic server required')
const health = await (await fetch(api + '/health')).json()
assert.ok(['test', 'development'].includes(health.environment), 'Isolated test/development data required')
const supplement = process.env.PRODUCT_AUDIT_SCOPE === 'supplement'
const output = process.env.PRODUCT_AUDIT_OUTPUT || (supplement ? 'test-results/product-route-supplement' : 'test-results/product-route-audit')
await mkdir(output, { recursive: true })
const contextFile = process.env.PRODUCT_AUDIT_CONTEXT || 'C:/Users/Lenovo/Desktop/gptttt/task_tmp/product-ui-context.json'
const fixture = JSON.parse(await readFile(contextFile, 'utf8'))
assert.equal(fixture.data, 'isolated_synthetic_only')
async function login(username) {
  const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: process.env.PRODUCT_AUDIT_PASSWORD || 'family-browser-test' }) })
  assert.equal(response.status, 200, 'Synthetic account login failed')
  return response.json()
}
async function read(path, account) {
  const response = await fetch(api + path, { headers: { Authorization: 'Bearer ' + account.access_token } })
  assert.ok(response.ok, `Authorized GET ${path.split('?')[0]} returned ${response.status}`)
  return response.json()
}
const definitions = [
  { key: 'admin', username: 'admin', app: 'admin', widths: [1280, 320] },
  { key: 'supervisor', username: 'manager', app: 'admin', widths: [1280, 320] },
  { key: 'caregiver', username: 'nurse', app: 'mobile', widths: [320, 390, 430] },
  { key: 'nurse', username: fixture.nurse_username, app: 'mobile', widths: [320, 390, 430] },
]
if (supplement) definitions.push(
  { key: 'admin', username: 'admin', app: 'mobile', widths: [320, 390, 430], batch: 'admin-mobile' },
  { key: 'supervisor', username: 'manager', app: 'mobile', widths: [320, 390, 430], batch: 'supervisor-mobile' },
)
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && existsSync(candidate))
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const results = [], skipped = []
function routesFor(app, data, role) {
  const elder = data.elders.find(row => row.current_admission_id) || data.elders[0]
  if (supplement) {
    if (app === 'admin') return role === 'admin' ? ['/demo'] : []
    const routes = ['/notifications/business/changes?read=1&action=%2Fchange-reviews']
    if (elder) routes.push('/notifications/business/memories?read=1&action=%2Fmemories&elder_id=' + encodeURIComponent(elder.id))
    if (['admin', 'supervisor'].includes(role)) routes.push('/notifications/business/family?read=1&action=%2Ffamily%2Fcases')
    return routes
  }
  const task = data.tasks[0], incident = data.incidents[0]
  const baseRoutes = app === 'admin'
    ? ['/dashboard', '/notifications', '/followups', '/elders', '/admission', '/assessment', '/care-plan', '/tasks', '/quality', '/coverage', '/changes', '/timeline', '/settings', '/recovery', ...['elders', 'admission', 'assessments', 'plans', 'records', 'tasks', 'shifts', 'handovers', 'quality', 'memories', 'changes', 'incidents', 'reports', 'staff'].map(group => '/workflows/' + group)]
    : ['/caregiver', '/records', '/records/drafts', '/records/history', '/records/new', '/tasks/new', '/elders', '/handover', '/safety', '/followups', '/notifications', '/account', '/account/recovery', '/timeline']
  if (elder) for (const section of ['today', 'records', 'profile', ...(data.canReadUnderstanding ? ['understanding'] : []), ...(app === 'admin' ? ['assessment'] : [])]) baseRoutes.push(`/elders/${encodeURIComponent(elder.id)}?section=${section}`)
  if (task) baseRoutes.push(app === 'admin' ? '/tasks?task=' + encodeURIComponent(task.id) : '/tasks/' + encodeURIComponent(task.id))
  if (task) baseRoutes.push('/timeline/' + encodeURIComponent(task.id))
  if (incident) baseRoutes.push((app === 'admin' ? '/workflows/incidents' : '/safety') + '?incident_id=' + encodeURIComponent(incident.id) + '&read=1')
  return role === 'supervisor' && app === 'admin'
    ? baseRoutes.filter(route => !['/settings', '/demo', '/recovery', '/workflows/staff', '/workflows/memories'].includes(route))
    : baseRoutes
}
async function inspect(page) {
  return page.evaluate(() => {
    const viewport = innerWidth, width = document.documentElement.scrollWidth
    const visible = element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' }
    const controls = [...document.querySelectorAll('select,input[type="date"],input[type="time"],input[type="datetime-local"]')].filter(visible).map(element => element.tagName + ':' + element.getAttribute('type'))
    const text = document.body.innerText
    const englishErrors = text.split('\n').filter(line => /\b(?:undefined|NaN|TypeError|ReferenceError|SyntaxError|Cannot read properties|Network Error|Request failed with status code|Internal Server Error|Unprocessable Entity|Failed to fetch|[a-z_]+_not_found|[a-z_]+_revision_conflict)\b/.test(line)).slice(0, 8)
    const overflowElements = width > viewport + 1 ? [...document.querySelectorAll('main *')].filter(visible).map(element => { const box = element.getBoundingClientRect(); return { tag: element.tagName, class: String(element.className).slice(0, 100), left: Math.round(box.left), right: Math.round(box.right) } }).filter(element => element.left < -1 || element.right > viewport + 1).slice(0, 12) : []
    return { viewport, documentWidth: width, nativeControls: controls, englishErrors, overflowElements, heading: document.querySelector('h1,h2')?.textContent?.trim() || '' }
  })
}
try {
  for (const definition of definitions) {
    const account = await login(definition.username)
    assert.equal(account.role, definition.key === 'supervisor' ? 'supervisor' : definition.key)
    const [elders, tasks, incidents] = await Promise.all([read('/elders', account), read('/tasks', account), read('/incidents', account)])
    const elder = elders.find(row => row.current_admission_id) || elders[0]
    let canReadUnderstanding = false
    if (elder) {
      const understanding = await read('/elders/' + encodeURIComponent(elder.id) + '/understanding', account)
      canReadUnderstanding = understanding.profile_summary_needed !== true
      if (!canReadUnderstanding) skipped.push({ role: definition.key, route: '/elders/:id?section=understanding', reason: 'Read page would automatically request a model-backed summary POST; this audit is GET-only.' })
    }
    for (const width of definition.widths) {
      const context = await browser.newContext({ viewport: { width, height: definition.app === 'mobile' ? 844 : 1000 }, reducedMotion: 'reduce' })
      await context.addInitScript(account => sessionStorage.setItem('hulao:session:v2', JSON.stringify({ mode: 'api', accountKey: 'synthetic-route-audit-' + account.user_id, userId: account.user_id, role: account.role, accessToken: account.access_token })), account)
      const page = await context.newPage()
      page.setDefaultTimeout(12000)
      let runtime = [], failedReads = [], writes = [], warnings = []
      page.on('pageerror', error => runtime.push(error.message))
      page.on('console', message => { if (message.type() === 'warning' && /\[Vue warn\]/.test(message.text())) warnings.push(message.text().slice(0, 300)) })
      page.on('response', response => { if (response.url().includes('/api/v1/') && response.status() >= 400) failedReads.push({ path: new URL(response.url()).pathname, status: response.status() }) })
      page.on('request', request => { if (request.url().includes('/api/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: new URL(request.url()).pathname, method: request.method() }) })
      try {
        let index = 0
        for (const route of routesFor(definition.app, { elders, tasks, incidents, canReadUnderstanding }, definition.key)) {
          runtime = []; failedReads = []; writes = []; warnings = []
          const name = `${definition.batch || definition.key}-${width}-${String(++index).padStart(2, '0')}-${route.split('?')[0].replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-/, '')}`
          let navigationError = ''
          try {
            await page.goto(base + '/' + definition.app + route, { waitUntil: 'domcontentloaded' })
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await page.waitForTimeout(250)
          } catch (error) { navigationError = error.message.split('\n')[0] }
          const inspection = await inspect(page)
          await page.screenshot({ path: output + '/' + name + '.png', fullPage: true })
          const entry = { name, role: account.role, app: definition.app, route, width, ...inspection, runtimeErrors: [...runtime], failedReads: [...failedReads], unexpectedWrites: [...writes], vueWarnings: [...warnings], navigationError }
          entry.passed = !navigationError && inspection.documentWidth <= width + 1 && !inspection.nativeControls.length && !inspection.englishErrors.length && !runtime.length && !failedReads.length && !writes.length && !warnings.length
          results.push(entry)
          if (writes.length) throw new Error('Read-only audit encountered an automatic write; stopping this route batch')
        }
      } finally { await context.close() }
      const batch = results.filter(result => result.name.startsWith(`${definition.batch || definition.key}-${width}-`))
      process.stdout.write(`${definition.key} ${width}px: ${batch.length} pages read, ${batch.filter(result => !result.passed).length} findings.\n`)
      await writeFile(output + '/results.json', JSON.stringify({ backend: health, results, skipped }, null, 2))
    }
  }
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ backend: health, results, skipped }, null, 2))
  await browser.close()
}
const failures = results.filter(result => !result.passed)
process.stdout.write(`${results.length} authorized read-only page visits; ${failures.length} visits need review.\n`)
if (failures.length) process.exitCode = 1

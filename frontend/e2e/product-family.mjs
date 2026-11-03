import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.PRODUCT_TEST_URL || 'http://127.0.0.1:5231'
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'This acceptance script uses a local isolated synthetic server only.',
)
const password = process.env.PRODUCT_TEST_PASSWORD
assert(
  password,
  'Set PRODUCT_TEST_PASSWORD to the isolated synthetic account password.',
)
const directory = 'test-results/product-family'
await mkdir(directory, { recursive: true })
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => candidate && existsSync(candidate))
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
})
const adminContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
})
const familyContext = await browser.newContext({
  viewport: { width: 390, height: 900 },
})
const admin = await adminContext.newPage(),
  family = await familyContext.newPage()
const errors = [],
  receipts = [],
  layoutFailures = [],
  failedResources = []
let checks = 0
function check(condition, message) {
  assert(condition, message)
  checks++
}
for (const page of [admin, family]) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(message.text() + ' [' + message.location().url + ']')
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedResources.push({ url: response.url(), status: response.status() })
    if (new URL(response.url()).pathname.startsWith('/api/v1/family/'))
      receipts.push({
        path: new URL(response.url()).pathname,
        method: response.request().method(),
        status: response.status(),
      })
  })
}
async function login(page, app, username) {
  await page.goto(`${base}/${app}/login`)
  const details = page.locator('details.credential-login')
  if (!(await details.evaluate((node) => node.open)))
    await details.locator('summary').click()
  await page.locator('input[autocomplete=username]').fill(username)
  await page.locator('input[autocomplete=current-password]').fill(password)
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/login') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '登录', exact: true }).click()
  check((await response).status() === 200, `${username} actual login failed`)
  await page.waitForURL((url) => !url.pathname.endsWith('/login'))
}
async function mutation(page, path, method, button) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1' + path &&
      response.request().method() === method,
  )
  await button.click()
  const result = await response
  check(result.ok(), `${method} ${path} returned ${result.status()}`)
  return result.json()
}
async function viewport(page, width, label) {
  await page.setViewportSize({ width, height: 1000 })
  await page.screenshot({
    path: `${directory}/${label}-${width}.png`,
    fullPage: true,
  })
  if (
    !(await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ))
  ) {
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map((node) => ({
          tag: node.tagName,
          class: String(node.className),
          text: node.textContent?.trim().slice(0, 60),
          right: node.getBoundingClientRect().right,
          left: node.getBoundingClientRect().left,
          width: node.getBoundingClientRect().width,
        }))
        .filter(
          (node) =>
            node.width > 0 && (node.right > innerWidth + 1 || node.left < -1),
        )
        .slice(0, 30),
    )
    await writeFile(
      `${directory}/${label}-overflow-${width}.json`,
      JSON.stringify(overflow, null, 2),
    )
    layoutFailures.push(`${label} page overflows at ${width}px`)
  }
}

try {
  await login(admin, 'admin', process.env.PRODUCT_ADMIN_ACCOUNT || 'admin')
  await admin.goto(`${base}/admin/family`)
  const workspace = admin.getByRole('region', {
    name: '家属简报工作区',
    exact: true,
  })
  await workspace.getByRole('combobox', { name: '老人', exact: true }).click()
  await admin.getByRole('option', { name: /张阿姨/ }).click()
  await workspace
    .locator('.summary-record input[type=checkbox]')
    .first()
    .check()
  const quote = await workspace
    .locator('.summary-record textarea')
    .first()
    .inputValue()
  const marker = '【虚构联调记录 ' + Date.now() + '】'
  const text = `${quote}\n${marker}`
  await workspace.getByRole('textbox', { name: /^公开正文/ }).fill(text)
  await workspace
    .getByRole('checkbox', {
      name: '我已逐条核对拟公开片段及披露范围。',
      exact: true,
    })
    .check()
  const preview = await mutation(
    admin,
    '/family/summaries/preview-selection',
    'POST',
    workspace.getByRole('button', {
      name: '预览家属将看到的内容',
      exact: true,
    }),
  )
  check(
    preview.family_preview.text === text,
    'Server preview body differs from the reviewed public body',
  )
  check(preview.recipient_count > 0, 'Synthetic recipient grant is missing')
  const save = workspace.getByRole('button', {
    name: '保存简报草稿',
    exact: true,
  })
  check(await save.isEnabled(), 'Reviewed preview did not unlock draft saving')
  await workspace
    .getByRole('textbox', { name: /^公开正文/ })
    .fill(text + '\n再次核对。')
  check(
    await save.isDisabled(),
    'Changed public text did not require a new server preview',
  )
  await mutation(
    admin,
    '/family/summaries/preview-selection',
    'POST',
    workspace.getByRole('button', {
      name: '预览家属将看到的内容',
      exact: true,
    }),
  )
  for (const width of [320, 390, 430, 1280, 1440])
    await viewport(admin, width, 'public-preview')
  const draft = await mutation(
    admin,
    '/family/summaries/from-selection',
    'POST',
    save,
  )
  check(
    draft.status === 'draft' && draft.text === text + '\n再次核对。',
    'Create did not return the actual reviewed draft',
  )
  const saved = workspace.locator('[aria-labelledby=summary-saved]')
  await saved
    .getByLabel('编辑草稿正文', { exact: false })
    .fill(draft.text + '\n已完成文字核对。')
  await saved
    .getByLabel('修改说明', { exact: false })
    .fill('隔离虚构数据，核对编辑流程。')
  await saved.getByRole('button', { name: '预览当前正文', exact: true }).click()
  const edited = await mutation(
    admin,
    '/family/summaries/' + draft.id,
    'PATCH',
    saved.getByRole('button', { name: '保存修改后的草稿', exact: true }),
  )
  check(
    edited.revision === draft.revision + 1 &&
      edited.text.endsWith('已完成文字核对。'),
    'Draft edit did not return the next stored revision',
  )
  await saved
    .getByLabel('发布核对说明', { exact: false })
    .fill('已核对虚构公开正文与当前授权家属。')
  await saved.getByRole('button', { name: '预览当前正文', exact: true }).click()
  await saved
    .getByRole('checkbox', {
      name: '我已核对公开正文，同意向当前有效授权家属发布。',
      exact: true,
    })
    .check()
  const published = await mutation(
    admin,
    '/family/summaries/' + draft.id + '/review',
    'POST',
    saved.getByRole('button', { name: '确认发布简报', exact: true }),
  )
  check(
    published.status === 'published' &&
      published.revision === edited.revision + 1,
    'Publish receipt is not the actual next revision',
  )
  await login(family, 'mobile', process.env.PRODUCT_FAMILY_ACCOUNT || 'family')
  await family.getByRole('radio', { name: /张阿姨/ }).check()
  const timelineResponse = family.waitForResponse((response) =>
    /\/family\/me\/bindings\/[^/]+\/timeline/.test(response.url()),
  )
  await family
    .getByRole('button', { name: '看看家人的近况', exact: false })
    .click()
  const timeline = await (await timelineResponse).json()
  check(
    timeline.items.some(
      (item) => item.id === published.id && item.text === published.text,
    ),
    'Family API did not return the published body',
  )
  await family.getByText(marker, { exact: false }).waitFor({ state: 'visible' })
  for (const width of [320, 390, 430])
    await viewport(family, width, 'family-published')
  await admin.goto(
    `${base}/admin/family?elder=${encodeURIComponent(published.elder_id)}&summary_id=${encodeURIComponent(published.id)}`,
  )
  const deepLinked = admin.locator('[aria-labelledby=summary-saved]')
  await deepLinked.getByText(/已发布/).waitFor()
  check(
    (await deepLinked.locator('textarea').first().inputValue()) ===
      published.text,
    'Inbox deep link did not open the selected stored summary',
  )
  await deepLinked
    .getByLabel('撤回原因', { exact: false })
    .fill('隔离虚构联调结束，核对撤回流程。')
  const withdrawn = await mutation(
    admin,
    '/family/summaries/' + draft.id + '/review',
    'POST',
    deepLinked.getByRole('button', { name: '确认撤回这份简报', exact: true }),
  )
  check(
    withdrawn.status === 'withdrawn' &&
      withdrawn.revision === published.revision + 1,
    'Withdraw receipt is not the actual next revision',
  )
  const refreshed = family.waitForResponse((response) =>
    /\/family\/me\/bindings\/[^/]+\/timeline/.test(response.url()),
  )
  await family
    .getByRole('button', { name: '刷新生活动态', exact: true })
    .click()
  const afterWithdraw = await (await refreshed).json()
  check(
    !afterWithdraw.items.some((item) => item.id === published.id),
    'Withdrawn summary still appears in the family API',
  )
  await family.getByText(marker, { exact: false }).waitFor({ state: 'hidden' })
  await writeFile(
    `${directory}/resources.json`,
    JSON.stringify(
      { failedResources, browser_errors: errors, layoutFailures, receipts },
      null,
      2,
    ),
  )
  check(
    errors.length === 0,
    'Browser errors: ' +
      errors.join('; ') +
      ' Resources: ' +
      JSON.stringify(failedResources),
  )
  check(layoutFailures.length === 0, layoutFailures.join('; '))
  check(
    receipts.every((receipt) => receipt.status < 400),
    'A family API request failed during the normal lifecycle',
  )
  await writeFile(
    `${directory}/results.json`,
    JSON.stringify(
      {
        checks,
        synthetic: true,
        summary_id: published.id,
        statuses: [
          draft.status,
          edited.status,
          published.status,
          withdrawn.status,
        ],
        widths: [320, 390, 430, 1280, 1440],
        receipts,
        browser_errors: errors,
      },
      null,
      2,
    ),
  )
  process.stdout.write(
    `${checks} real API family lifecycle checks passed; stored draft → edited draft → published → withdrawn.\n`,
  )
} catch (error) {
  await admin
    .screenshot({ path: `${directory}/failure-admin.png`, fullPage: true })
    .catch(() => {})
  await family
    .screenshot({ path: `${directory}/failure-family.png`, fullPage: true })
    .catch(() => {})
  throw error
} finally {
  await browser.close()
}

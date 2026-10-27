import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Creates one synthetic elder. Deliberately refuse non-loopback destinations.
const base = process.env.FAMILY_API_URL || 'http://127.0.0.1:5177'
const api = process.env.FAMILY_BACKEND_URL || 'http://127.0.0.1:8769/api/v1'
for (const url of [base, api]) assert.equal(new URL(url).hostname, '127.0.0.1')
const output = 'test-results/family-demo-all'
await mkdir(output, { recursive: true })
async function login(username) {
  const response = await fetch(api + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'family-browser-test' }),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const family = await login('family'),
  admin = await login('admin')
const headers = { Authorization: 'Bearer ' + family.access_token }
const before = await (
  await fetch(api + '/family/me/bindings', { headers })
).json()
assert.ok(before.length >= 2 && before.every((row) => row.demo_access === true))
const created = await fetch(api + '/elders', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + admin.access_token,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: '赵叔叔', notes: '仅用于本机隔离演示选人验收' }),
})
assert.equal(created.status, 201)
const elder = await created.json()
const after = await (
  await fetch(api + '/family/me/bindings', { headers })
).json()
assert.equal(after.length, before.length + 1)
const added = after.find((row) => row.elder_id === elder.id)
assert.ok(added?.demo_access && added.admission_id === null)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = [],
  errors = []
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(
    (auth) =>
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          mode: 'api',
          accountKey: 'synthetic-demo-family',
          userId: auth.user_id,
          role: 'family',
          accessToken: auth.access_token,
        }),
      ),
    family,
  )
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base + '/mobile/family')
  await page
    .getByText(
      '演示账号可选择、切换全部老人，查看各自已发布的生活动态和近况小结。',
      { exact: true },
    )
    .waitFor()
  assert.equal(await page.locator('.family-member').count(), after.length)
  async function choose(name) {
    await page.locator('.family-member').filter({ hasText: name }).click()
    await page.getByRole('button', { name: '看看家人的近况' }).click()
    await page
      .getByRole('heading', { name: name + '的日常', exact: true })
      .waitFor()
  }
  await choose('张阿姨')
  await page.locator('.story-card').first().waitFor()
  await page.locator('.digest-points').waitFor()
  const firstStories = await page.locator('.story-text').allTextContents()
  await page.getByLabel('给照护团队的留言').fill('仅给张阿姨的演示留言草稿')
  await page.getByRole('button', { name: '切换家人' }).click()
  await choose('赵叔叔')
  await page.getByRole('heading', { name: '相册还在慢慢写' }).waitFor()
  assert.equal(await page.locator('.story-card').count(), 0)
  assert.equal(await page.locator('.digest-points').count(), 0)
  assert.equal(await page.getByLabel('给照护团队的留言').inputValue(), '')
  results.push('新增未入住老人自动可选，空时间线不残留他人图文、小结和留言')
  await page.screenshot({
    path: output + '/new-elder-empty-390.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '切换家人' }).click()
  await choose('李爷爷')
  await page.locator('.story-card').first().waitFor()
  await page.locator('.digest-points').waitFor()
  assert.notDeepEqual(
    await page.locator('.story-text').allTextContents(),
    firstStories,
  )
  assert.equal(await page.getByLabel('给照护团队的留言').inputValue(), '')
  await page.getByRole('button', { name: '切换家人' }).click()
  await choose('张阿姨')
  await page.locator('.story-card').first().waitFor()
  assert.deepEqual(
    await page.locator('.story-text').allTextContents(),
    firstStories,
  )
  assert.equal(
    await page.getByLabel('给照护团队的留言').inputValue(),
    '仅给张阿姨的演示留言草稿',
  )
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  )
  assert.deepEqual(errors, [])
  results.push('三位老人切换隔离，返回后恢复各自留言草稿，手机无横向溢出')
  await page.screenshot({ path: output + '/selected-390.png', fullPage: true })
  console.log(JSON.stringify({ passed: true, checks: results, errors }))
  await writeFile(
    output + '/results.json',
    JSON.stringify({ passed: true, checks: results, errors }, null, 2),
  )
} finally {
  await browser.close()
}

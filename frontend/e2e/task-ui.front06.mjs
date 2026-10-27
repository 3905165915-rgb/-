import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL || 'http://127.0.0.1:5175'
const output = resolve(process.env.UI_OUTPUT || 'test-results/front06')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'msedge',
})
const errors = []
const passed = []
async function check(name, run) {
  await run()
  passed.push(name)
  console.log('PASS ' + name)
}
async function login(app, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/${app}/login`)
  const labels = {
    caregiver: '护理员',
    supervisor: '护士 / 主管',
    admin: '管理员',
    family: '家属',
  }
  await page
    .getByRole('button', {
      name: new RegExp(labels[app === 'mobile' ? 'caregiver' : 'supervisor']),
    })
    .click()
  await page
    .locator(app === 'mobile' ? '.mobile-header' : '.admin-sidebar')
    .waitFor()
  return page
}
async function mutate(page, update) {
  await page.evaluate(async (source) => {
    const { loadDemoState, updateDemoState } =
      await import('/packages/shared/src/demo-store.ts')
    const state = await loadDemoState()
    await updateDemoState(state.epoch, new Function('state', source))
  }, update)
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  )
}

try {
  const mobile = await login('mobile', 390)
  const admin = await login('admin', 1440)
  await check(
    'mobile: snapshot bed, formatted times and primary labels at 320/390/430px',
    async () => {
      await mobile.locator('.task-row').first().waitFor()
      await mutate(mobile, "state.elders[0].bedLabel = '202房·2床'")
      await mobile.getByText('202房·2床', { exact: true }).first().waitFor()
      const task = mobile
        .locator('.task-row')
        .filter({ hasText: '询问并安排听戏活动' })
      assert.match(await task.innerText(), /101房·1床/)
      assert.match(await task.innerText(), /执行：.*15:00/)
      assert.match(await task.innerText(), /截止：.*16:00/)
      assert.match(await task.innerText(), /开始服务/)
      for (const width of [320, 390, 430]) {
        await mobile.setViewportSize({ width, height: 900 })
        await noOverflow(mobile)
      }
      await mobile.getByRole('searchbox').fill('101房')
      await task.waitFor()
      assert.ok((await mobile.locator('.task-row').count()) > 0)
      await mobile.getByRole('searchbox').fill('')
      await mobile.screenshot({
        path: resolve(output, 'mobile-workbench.png'),
        fullPage: true,
      })
    },
  )
  await check('mobile: completed result is read only', async () => {
    await mobile.goto(`${base}/mobile/tasks/task-wang-rest`)
    await mobile.locator('.task-result').waitFor()
    assert.match(await mobile.locator('.task-result').innerText(), /按本人意愿/)
    assert.equal(await mobile.locator('.form-band').count(), 0)
    assert.equal(await mobile.locator('.editor-footer').count(), 0)
    await noOverflow(mobile)
  })
  await check(
    'mobile: start service, then register result; reason only for not done',
    async () => {
      await mobile.goto(`${base}/mobile/tasks/task-wang-listen`)
      await mobile
        .getByRole('button', { name: '开始服务', exact: true })
        .click()
      await mobile
        .getByRole('button', { name: '填写下一操作', exact: true })
        .click()
      const action = mobile.locator('.form-band select').first()
      await action.selectOption('not_done')
      await mobile
        .locator('.form-band label')
        .filter({ hasText: '未执行原因' })
        .waitFor()
      await action.selectOption('complete')
      assert.equal(
        await mobile
          .locator('.form-band label')
          .filter({ hasText: '未执行原因' })
          .count(),
        0,
      )
      await mobile
        .getByPlaceholder('填写本次观察及处理结果')
        .fill('本人同意后安排听戏，音量合适。')
      await mobile
        .getByRole('button', { name: '登记结果', exact: true })
        .click()
      await mobile.locator('.task-result').waitFor()
      assert.match(await mobile.locator('.task-result').innerText(), /音量合适/)
      assert.equal(
        await mobile
          .getByRole('button', { name: '登记结果', exact: true })
          .count(),
        0,
      )
      await mobile.screenshot({
        path: resolve(output, 'mobile-result.png'),
        fullPage: true,
      })
    },
  )
  await check(
    'admin: visible actions and formatted execution/deadline columns',
    async () => {
      await admin.goto(`${base}/admin/tasks`)
      const row = admin
        .locator('.el-table__row')
        .filter({ hasText: '询问并安排听戏活动' })
      await row.waitFor()
      assert.match(await row.innerText(), /执行：.*15:00/)
      assert.match(await row.innerText(), /截止：.*16:00/)
      await row
        .getByRole('button', { name: '询问并安排听戏活动：开始服务' })
        .click()
      await admin.locator('.task-action-drawer').waitFor()
      assert.equal(
        await admin.getByText('未执行原因（必填）', { exact: true }).count(),
        0,
      )
      await noOverflow(admin)
    },
  )
  await check(
    'admin: refresh while drawer is open discards stale task action',
    async () => {
      await mutate(
        admin,
        "const task = state.tasks.find(row => row.id === 'task-wang-listen'); task.status = 'completed'; task.result = '其他护理员已登记'; state.elders[0].bedLabel = '202房·2床'",
      )
      const drawer = admin.locator('.task-action-drawer')
      await drawer.getByText('其他护理员已登记', { exact: true }).waitFor()
      assert.match(
        await drawer.locator('.drawer-identity').innerText(),
        /101房·1床/,
      )
      assert.equal(await drawer.locator('.el-form').count(), 0)
      assert.equal(
        await drawer
          .getByRole('button', { name: '开始服务', exact: true })
          .count(),
        0,
      )
      assert.equal(
        await drawer
          .getByRole('button', { name: '登记结果', exact: true })
          .count(),
        0,
      )
      await admin.screenshot({
        path: resolve(output, 'admin-refreshed-result.png'),
        fullPage: true,
      })
    },
  )
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ passed, errors }, null, 2),
  )
} finally {
  await browser.close()
}

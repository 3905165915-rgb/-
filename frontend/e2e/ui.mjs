import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:5175'
const output = resolve(process.env.UI_OUTPUT ?? 'test-results/ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
})
const results = []
const errors = []
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
const adminContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
})
for (const context of [mobileContext, adminContext]) {
  context.setDefaultTimeout(12000)
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  )
}
const mobile = await mobileContext.newPage()
const admin = await adminContext.newPage()

async function test(name, run) {
  try {
    await run()
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, passed: false, error: String(error.stack ?? error) })
    console.error('FAIL ' + name + ': ' + error.message)
    await Promise.all(
      [mobile, admin].map((page, index) =>
        page
          .screenshot({
            path: resolve(output, `failure-${results.length}-${index}.png`),
            fullPage: true,
          })
          .catch(() => {}),
      ),
    )
  }
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert.ok(
    dimensions.scroll <= dimensions.width + 1,
    JSON.stringify(dimensions),
  )
}

async function capture(page, name) {
  await page.screenshot({
    path: resolve(output, name + '.png'),
    fullPage: true,
  })
}

async function login(page, app, role) {
  await page.goto(`${base}/${app}/login`)
  if (role) await page.locator('select').selectOption(role)
  await page.getByRole('button', { name: '进入演示' }).click()
  await page
    .locator(app === 'mobile' ? '.mobile-header' : '.admin-sidebar')
    .waitFor()
}

try {
  await test('两端登录与实际图标加载', async () => {
    await login(mobile, 'mobile', 'caregiver')
    await login(admin, 'admin')
    await mobile.locator('.task-row').first().waitFor()
    await admin.locator('h1').waitFor()
    assert.ok((await mobile.locator('svg.lucide').count()) > 0)
    assert.ok((await admin.locator('svg.lucide').count()) > 0)
    await noOverflow(mobile)
    await noOverflow(admin)
  })

  await test('移动端320/390/430px，搜索、空筛选、弹层边界', async () => {
    for (const width of [320, 390, 430]) {
      await mobile.setViewportSize({ width, height: 844 })
      await mobile.goto(`${base}/mobile/caregiver`)
      await mobile.locator('.task-row').first().waitFor()
      await noOverflow(mobile)
      await capture(mobile, `mobile-workbench-${width}`)
      const search = mobile.getByRole('searchbox')
      await search.fill('不存在的任务' + '很长的搜索文字'.repeat(12))
      await mobile
        .getByText('没有匹配任务，请调整筛选', { exact: true })
        .waitFor()
      await noOverflow(mobile)
      await search.fill('')
      await mobile
        .getByRole('button', { name: '高级筛选', exact: true })
        .click()
      const close = mobile.getByRole('button', {
        name: '关闭筛选',
        exact: true,
      })
      await close.waitFor()
      await close.click({ trial: true })
      await noOverflow(mobile)
      await capture(mobile, `mobile-filters-${width}`)
      if (width === 390) {
        await mobile
          .getByRole('combobox', { name: '班次', exact: true })
          .selectOption('早班')
        await mobile.waitForURL(
          (url) => url.searchParams.get('shift') === '早班',
        )
        await mobile
          .getByRole('combobox', { name: '状态', exact: true })
          .selectOption('cancelled')
        await mobile.waitForURL(
          (url) => url.searchParams.get('status') === 'cancelled',
        )
        await close.click()
        await mobile
          .getByText('没有匹配任务，请调整筛选', { exact: true })
          .waitFor()
        await mobile.reload()
        await mobile
          .getByRole('button', { name: '高级筛选', exact: true })
          .click()
        assert.equal(
          await mobile
            .getByRole('combobox', { name: '班次', exact: true })
            .inputValue(),
          '早班',
        )
        assert.equal(
          await mobile
            .getByRole('combobox', { name: '状态', exact: true })
            .inputValue(),
          'cancelled',
        )
        await mobile.getByRole('button', { name: '重置', exact: true }).click()
        await mobile.waitForURL(
          (url) =>
            !url.searchParams.has('status') && !url.searchParams.has('shift'),
        )
      }
      await close.click()
    }
  })

  await test('移动端填写页只保留一套底栏，固定操作可见', async () => {
    const taskPath = await mobile
      .locator('.task-row')
      .first()
      .getAttribute('href')
    assert.ok(taskPath)
    for (const width of [320, 430]) {
      await mobile.setViewportSize({ width, height: 844 })
      for (const [name, path] of [
        ['task', taskPath],
        ['record', '/mobile/records/new'],
        ['handover', '/mobile/handover'],
      ]) {
        await mobile.goto(new URL(path, base).href)
        if (name === 'handover')
          await mobile
            .getByRole('button', { name: '早班', exact: true })
            .click()
        await mobile.locator('.editor-footer').waitFor()
        const tabbar = mobile.locator('.van-tabbar')
        assert.equal(await tabbar.count(), name === 'handover' ? 1 : 0)
        await noOverflow(mobile)
        const bounds = await mobile.locator('.editor-footer').boundingBox()
        assert.ok(
          bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
        )
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 845)
        if (name === 'handover') {
          const navigationBounds = await tabbar.boundingBox()
          assert.ok(
            navigationBounds && bounds.y + bounds.height <= navigationBounds.y + 1,
            JSON.stringify({ footer: bounds, navigation: navigationBounds }),
          )
        }
        await capture(mobile, `mobile-${name}-${width}`)
        if (name === 'handover' && width === 320) {
          await mobile.locator('.handover-source .van-checkbox').first().click()
          await mobile
            .getByRole('searchbox', { name: '搜索已载入事项', exact: true })
            .fill('不存在的事项')
          await mobile
            .getByText('没有匹配事项，请调整筛选', { exact: true })
            .waitFor()
          assert.match(
            await mobile.locator('.handover-editor').innerText(),
            /已选\s*1\s*项/,
          )
          await mobile
            .getByRole('button', { name: '筛选延续事项', exact: true })
            .click()
          await mobile
            .getByRole('combobox', { name: '来源班次', exact: true })
            .selectOption('早班')
          await mobile
            .getByRole('button', { name: '重置筛选', exact: true })
            .click()
          await mobile
            .getByRole('button', { name: '关闭事项筛选', exact: true })
            .click()
          await mobile.locator('.handover-source').first().waitFor()
          assert.equal(
            await mobile
              .locator('.handover-source .van-checkbox')
              .first()
              .getAttribute('aria-checked'),
            'true',
          )
        }
      }
    }
  })

  await test('本机草稿弹层关闭入口在320px可操作', async () => {
    await mobile.setViewportSize({ width: 320, height: 740 })
    await mobile.goto(`${base}/mobile/caregiver`)
    await mobile.getByRole('button', { name: '本机草稿', exact: true }).click()
    await mobile
      .getByRole('button', { name: '关闭草稿管理', exact: true })
      .click({ trial: true })
    await noOverflow(mobile)
    await capture(mobile, 'mobile-drafts-320')
    await mobile
      .getByRole('button', { name: '关闭草稿管理', exact: true })
      .click()
  })

  await test('降低透明度可开关并在刷新后恢复', async () => {
    await mobile
      .getByRole('button', { name: '我的', exact: true })
      .click()
    await mobile.waitForURL('**/mobile/account')
    const toggle = mobile.getByRole('switch', {
      name: '降低透明度',
      exact: true,
    })
    await toggle.click()
    assert.equal(
      await mobile.locator('html').getAttribute('data-reduce-transparency'),
      'true',
    )
    assert.equal(
      await mobile
        .locator('.mobile-header')
        .evaluate((node) => getComputedStyle(node).backdropFilter),
      'none',
    )
    await mobile.reload()
    assert.equal(
      await mobile.locator('html').getAttribute('data-reduce-transparency'),
      'true',
    )
    await mobile
      .getByRole('switch', { name: '降低透明度', exact: true })
      .click()
    assert.equal(
      await mobile.locator('html').getAttribute('data-reduce-transparency'),
      'false',
    )
  })

  await test('恢复日志入口可达且演示环境不读取正式日志', async () => {
    await mobile.goto(`${base}/mobile/account`)
    await mobile.getByRole('link', { name: '恢复日志' }).click()
    await mobile.getByRole('heading', { name: '恢复日志', exact: true }).waitFor()
    await mobile
      .getByText(/仅在正式 API 环境中读取/)
      .waitFor()
    await admin.goto(`${base}/admin/recovery`)
    await admin
      .getByRole('heading', { name: '本机恢复日志', exact: true })
      .waitFor()
    await admin
      .getByText(/仅在正式 API 环境中读取/)
      .waitFor()
  })

  await test('管理端1280/1440px任务、档案、抽屉与表格', async () => {
    for (const width of [1280, 1440]) {
      await admin.setViewportSize({ width, height: 1000 })
      await admin.goto(`${base}/admin/tasks`)
      await admin.locator('.el-table__body-wrapper tr').first().waitFor()
      await noOverflow(admin)
      await capture(admin, `admin-tasks-${width}`)
      await admin
        .getByRole('button', { name: '处理任务', exact: true })
        .first()
        .click()
      await admin.getByRole('dialog').waitFor()
      await noOverflow(admin)
      await capture(admin, `admin-task-drawer-${width}`)
      await admin.keyboard.press('Escape')
      await admin.goto(`${base}/admin/elders`)
      await admin.locator('.el-table__body-wrapper tr').first().waitFor()
      await noOverflow(admin)
      await capture(admin, `admin-elders-${width}`)
      await admin
        .getByRole('button', { name: '查看老人档案', exact: true })
        .first()
        .click()
      await admin.locator('h1').waitFor()
      await noOverflow(admin)
      await capture(admin, `admin-elder-detail-${width}`)
    }
  })

  await test('管理端其余模块与1024px导航', async () => {
    await admin.setViewportSize({ width: 1024, height: 768 })
    for (const route of [
      'dashboard',
      'admission',
      'assessment',
      'care-plan',
      'quality',
      'coverage',
      'changes',
      'family',
      'timeline',
      'demo',
    ]) {
      await admin.goto(`${base}/admin/${route}`)
      await admin.locator('h1').waitFor()
      await noOverflow(admin)
      await capture(admin, `admin-${route}-1024`)
    }
  })

  await test('家属授权视图与降低动效', async () => {
    await mobileContext.clearCookies()
    await mobile.evaluate(async () => {
      const { clearSession } = await import('/packages/shared/src/index.ts')
      clearSession()
    })
    await mobile.emulateMedia({ reducedMotion: 'reduce' })
    await login(mobile, 'mobile', 'family')
    await mobile.locator('h1').waitFor()
    await noOverflow(mobile)
    await capture(mobile, 'mobile-family-320')
    const duration = await mobile.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--hl-duration')
        .trim(),
    )
    assert.equal(duration, '0ms')
  })

  await test('UI访问无未捕获异常', async () => assert.deepEqual(errors, []))
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ results, errors }, null, 2),
  )
  await browser.close()
}
if (results.some((result) => !result.passed)) process.exitCode = 1

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const base = process.env.DEMO_URL || 'http://127.0.0.1:5175'
const output = resolve('test-results/wang-rebuild')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'msedge',
})
const context = await browser.newContext({
  viewport: { width: 390, height: 900 },
  timezoneId: 'America/Los_Angeles',
})
const errors = [],
  passed = []
context.on('page', (page) => {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
})
async function check(name, run) {
  await run()
  passed.push(name)
  console.log('PASS ' + name)
}
async function login(app, role) {
  const page = await context.newPage()
  if (app === 'admin') await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${base}/${app}/login`)
  const labels = {
    caregiver: '护理员',
    supervisor: '护士 / 主管',
    admin: '管理员',
    family: '家属',
  }
  await page.getByRole('button', { name: new RegExp(labels[role]) }).click()
  await page
    .locator(app === 'mobile' ? '.mobile-header' : '.admin-sidebar')
    .waitFor()
  return page
}
const state = (page) =>
  page.evaluate(async () =>
    (await import('/packages/shared/src/demo-store.ts')).loadDemoState(),
  )
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `Overflow: ${page.url()}`,
  )
}
try {
  const mobile = await login('mobile', 'caregiver')
  await check(
    'rebuild: one elder, 40 sources, coherent references and future pending task',
    async () => {
      await mobile.evaluate(async () =>
        (await import('/packages/shared/src/demo-store.ts')).resetDemo(),
      )
      const current = await state(mobile)
      assert.deepEqual(
        current.elders.map((elder) => elder.name),
        ['王爷爷'],
      )
      assert.equal(current.records.length, 40)
      assert.ok(
        current.tasks.some(
          (task) =>
            task.status === 'pending' &&
            Date.parse(task.executionAt) > Date.now(),
        ),
      )
      assert.ok(
        current.memories.every((memory) =>
          memory.sourceRecordIds.every((id) =>
            current.records.some(
              (record) =>
                record.id === id && record.content.includes(memory.quote),
            ),
          ),
        ),
      )
    },
  )
  await check(
    'mobile: elder context, unified records and source links at 320/390/430',
    async () => {
      for (const path of [
        '/caregiver',
        '/elders/elder-wang-101',
        '/records?tab=history',
      ]) {
        await mobile.goto(`${base}/mobile${path}`)
        await mobile
          .locator(
            path.startsWith('/records')
              ? '.record-list article'
              : path.startsWith('/elders')
                ? '.understanding'
                : '.task-row',
          )
          .first()
          .waitFor()
        if (path.startsWith('/elders')) {
          const current = await state(mobile)
          const expected = await mobile.evaluate(async () => {
            const shared =
              await import('/packages/shared/src/workflow/pending-work.ts')
            const store = await import('/packages/shared/src/demo-store.ts')
            return shared
              .demoFollowups(await store.loadDemoState(), true)
              .filter((row) => row.category !== 'processed').length
          })
          assert.ok(
            current.memoryReviews.some((row) => row.status === 'pending'),
          )
          assert.equal(
            await mobile
              .getByLabel('老人工作摘要')
              .locator('div')
              .filter({ hasText: '待跟进' })
              .locator('dd')
              .innerText(),
            String(expected),
          )
        }
        for (const width of [320, 390, 430]) {
          await mobile.setViewportSize({ width, height: 900 })
          await noOverflow(mobile)
        }
      }
    },
  )
  await check(
    'mobile: synchronous journal restores last keystrokes before debounce',
    async () => {
      await mobile.goto(`${base}/mobile/records/new?elder=elder-wang-101`)
      const field = mobile.getByPlaceholder('输入护理观察、待办或沟通内容')
      await field.fill('刷新前最后一段原文')
      await mobile.reload()
      await assert.doesNotReject(() =>
        mobile
          .getByPlaceholder('输入护理观察、待办或沟通内容')
          .filter({ visible: true })
          .waitFor(),
      )
      assert.equal(
        await mobile
          .getByPlaceholder('输入护理观察、待办或沟通内容')
          .inputValue(),
        '刷新前最后一段原文',
      )
    },
  )
  await check(
    'mobile: saved original, organization recovery and one confirmation without invented tasks',
    async () => {
      await mobile
        .getByRole('button', { name: '使用演示原文', exact: true })
        .click()
      await mobile
        .getByRole('button', { name: '保存并查看整理结果', exact: true })
        .click()
      await mobile
        .getByRole('heading', { name: '整理结果（待核对）' })
        .waitFor()
      await mobile.reload()
      await mobile
        .getByRole('heading', { name: '整理结果（待核对）' })
        .waitFor()
      const before = await state(mobile)
      await mobile
        .getByRole('button', { name: '确认并提交', exact: true })
        .click()
      await mobile.locator('.van-dialog__confirm').click()
      await mobile.getByText(/记录已确认并保存到本机/).waitFor()
      const after = await state(mobile)
      assert.equal(after.records.length, before.records.length + 1)
      assert.equal(after.tasks.length, before.tasks.length)
      assert.ok(
        after.memories.some((memory) =>
          memory.sourceRecordIds.includes(after.records.at(-1).id),
        ),
      )
      await mobile.screenshot({
        path: resolve(output, 'mobile-record.png'),
        fullPage: true,
      })
    },
  )
  await check(
    'mobile: manual task form persists, creates once and opens the actual task',
    async () => {
      await mobile.goto(`${base}/mobile/tasks/new?elder=elder-wang-101`)
      const form = mobile.locator('.demo-task-create')
      await form
        .getByLabel('照护事项', { exact: true })
        .fill('现场核对明日活动意愿')
      const current = await state(mobile)
      const tomorrow = new Date(
        Date.parse(current.demoDay + 'T12:00:00+08:00') + 86400000,
      )
        .toISOString()
        .slice(0, 10)
      await form
        .getByLabel('执行时间（北京时间）', { exact: true })
        .fill(`${tomorrow}T09:00`)
      await form
        .getByLabel('截止时间（北京时间）', { exact: true })
        .fill(`${tomorrow}T09:30`)
      await form.getByRole('combobox', { name: /^责任人/ }).selectOption('小王')
      await form.getByRole('combobox', { name: /^班次/ }).selectOption('早班')
      await form
        .getByRole('combobox', { name: /^服务场景/ })
        .selectOption('activity')
      await mobile.reload()
      assert.equal(
        await form.getByLabel('照护事项', { exact: true }).inputValue(),
        '现场核对明日活动意愿',
      )
      await form.getByRole('checkbox').check()
      await form.getByRole('button', { name: '确认新建任务' }).click()
      await form.getByRole('link', { name: '查看并办理任务' }).click()
      await mobile
        .getByRole('heading', { name: '现场核对明日活动意愿', exact: true })
        .waitFor()
      assert.equal(
        (await state(mobile)).tasks.filter(
          (task) => task.title === '现场核对明日活动意愿',
        ).length,
        1,
      )
      await noOverflow(mobile)
    },
  )
  const admin = await login('admin', 'supervisor')
  await admin.setViewportSize({ width: 1440, height: 960 })
  await check(
    'admin: plan preview blocks duplicates, confirms an edited arrangement once',
    async () => {
      await admin.goto(`${base}/admin/care-plan?elder=elder-wang-101`)
      await admin
        .getByRole('button', { name: '下一步：核对照护安排', exact: true })
        .click()
      await admin.getByRole('button', { name: /预览/ }).click()
      await admin.getByText(/已有相同事项与执行时间的任务/).waitFor()
      await admin
        .locator('.plan-item')
        .first()
        .getByLabel('事项', { exact: true })
        .fill('按本人意愿安排明日短段京剧')
      await admin.getByRole('button', { name: /预览/ }).click()
      await admin.getByRole('checkbox').check()
      await admin
        .getByRole('button', { name: '人工确认并生成任务', exact: true })
        .click()
      await admin.getByText(/计划已人工确认/).waitFor()
      const before = (await state(admin)).tasks.length
      await admin.reload()
      await admin.getByText(/计划已人工确认/).waitFor()
      assert.equal((await state(admin)).tasks.length, before)
      await admin.screenshot({
        path: resolve(output, 'admin-plan.png'),
        fullPage: true,
      })
    },
  )
  await check(
    'admin: candidate confirmation is per item; independent review cannot self-approve',
    async () => {
      await admin.goto(`${base}/admin/elders/elder-wang-101`)
      const candidate = admin.locator('[data-memory="memory-wang-4"]')
      await candidate
        .getByRole('button', { name: '确认这条', exact: true })
        .click()
      await candidate.getByText(/已人工确认/).waitFor()
      assert.equal(
        (await state(admin)).memories.find(
          (memory) => memory.id === 'memory-wang-2',
        ).content,
        '喜欢听京剧，偏好较低音量。',
      )
      const review = admin.locator('[data-review="review-wang-1"]')
      await review
        .getByRole('textbox')
        .fill('已重新询问，本次选择休息，不调整长期习惯。')
      await review.getByRole('button', { name: '提交核对，等待复查' }).click()
      await review.getByText('请由另一位主管或管理员独立复查。').waitFor()
      assert.equal(
        await review.getByRole('button', { name: '独立复查通过' }).count(),
        0,
      )
      const reviewer = await login('admin', 'admin')
      await reviewer.setViewportSize({ width: 1440, height: 960 })
      await reviewer.goto(`${base}/admin/elders/elder-wang-101`)
      const independent = reviewer.locator('[data-review="review-wang-1"]')
      await independent
        .getByRole('textbox')
        .fill('已独立复查，保留长期偏好并按当次意愿服务。')
      await independent.getByRole('button', { name: '独立复查通过' }).click()
      await independent.getByText('已处理', { exact: true }).waitFor()
    },
  )
  await check(
    'admin: handover reception does not complete the linked task',
    async () => {
      await admin.goto(`${base}/admin/workflows/handovers?shift=晚班`)
      const item = admin.locator('.demo-handovers > article').first()
      await item.getByRole('button', { name: '确认接班' }).click()
      await item.getByText(/已接收/).waitFor()
      assert.equal(
        (await state(admin)).tasks.find(
          (task) => task.id === 'task-wang-followup',
        ).status,
        'pending',
      )
      await noOverflow(admin)
    },
  )
  await check(
    'family: only released lifestyle data and no internal work forms',
    async () => {
      const family = await login('mobile', 'family')
      await family.getByText('王爷爷', { exact: false }).first().waitFor()
      assert.equal(await family.locator('[data-review]').count(), 0)
      assert.equal(
        await family.getByText('本次核对情况', { exact: true }).count(),
        0,
      )
      assert.equal(
        await family.getByText('护理记录', { exact: true }).count(),
        0,
      )
      for (const width of [320, 390, 430]) {
        await family.setViewportSize({ width, height: 900 })
        await noOverflow(family)
      }
      await family.goto(`${base}/mobile/elders/elder-wang-101`)
      await family.waitForURL(/\/mobile\/family$/)
      assert.match(family.url(), /\/mobile\/family$/)
    },
  )
  await check(
    'rebuild: archive old data/drafts, preserve API data, fence old pages and pending writes',
    async () => {
      const result = await mobile.evaluate(async () => {
        const store = await import('/packages/shared/src/demo-store.ts')
        const storage = await import('/packages/shared/src/storage.ts')
        const editorModule = await import('/packages/shared/src/editor.ts')
        const before = await store.loadDemoState()
        const api = editorModule.createRecordEditor(
          'api',
          'real-account',
          'real-elder',
        )
        api.text = '保留API草稿'
        await storage.saveRecordEditor(api)
        const demo = editorModule.createRecordEditor(
          'demo',
          'demo-caregiver',
          before.elders[0].id,
        )
        demo.demoEpoch = before.epoch
        demo.text = '旧批次草稿'
        await storage.saveRecordEditor(demo)
        storage.writeRecordJournal(demo)
        localStorage.setItem(
          'hulao:demo-form:test',
          JSON.stringify({ params: { epoch: before.epoch }, body: {} }),
        )
        const after = await store.resetDemo()
        let refused = false,
          draftRefused = false
        try {
          await store.updateDemoState(before.epoch, (state) =>
            state.records.push(before.records[0]),
          )
        } catch {
          refused = true
        }
        try {
          await storage.saveRecordEditor(demo)
        } catch {
          draftRefused = true
        }
        const db = await storage.openDatabase()
        const keys = await storage.requestResult(
          db.transaction('demoState').objectStore('demoState').getAllKeys(),
        )
        return {
          refused,
          draftRefused,
          changed: before.epoch !== after.epoch,
          api: (
            await storage.loadRecordEditor('api', api.accountKey, api.localId)
          )?.text,
          demo: await storage.listRecordEditors('demo', 'demo-caregiver'),
          archive: keys.some((key) =>
            String(key).startsWith(`archive:${before.epoch}:snapshot`),
          ),
          journal: localStorage.getItem('hulao:demo-form:test'),
          count: after.records.length,
        }
      })
      assert.equal(result.changed, true)
      assert.equal(result.refused, true)
      assert.equal(result.draftRefused, true)
      assert.equal(result.api, '保留API草稿')
      assert.deepEqual(result.demo, [])
      assert.equal(result.archive, true)
      assert.equal(result.journal, null)
      assert.equal(result.count, 40)
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

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:5175'
const output = resolve(process.env.TEST_OUTPUT ?? 'test-results')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
})
const context = await browser.newContext()
context.setDefaultTimeout(15000)
const results = []
const runtimeErrors = []
context.on('page', (page) =>
  page.on('pageerror', (error) => runtimeErrors.push(error.message)),
)
async function test(name, callback) {
  try {
    await callback()
    results.push({ name, passed: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    const pages = await Promise.all(
      context.pages().map(async (page, index) => {
        await page
          .screenshot({
            path: resolve(output, `failure-${results.length}-${index}.png`),
            fullPage: true,
          })
          .catch(() => {})
        return {
          url: page.url(),
          body: await page
            .locator('body')
            .innerText()
            .catch(() => ''),
        }
      }),
    )
    results.push({
      name,
      passed: false,
      error: String(error.stack ?? error),
      pages,
    })
    console.error(`FAIL ${name}: ${error.message}`)
  }
}
async function text(page, value) {
  await page
    .getByText(value, { exact: false })
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible' })
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  )
}
async function loginMobile(page, role = 'caregiver') {
  await page.goto(`${base}/mobile/login`)
  const label = {
    caregiver: '护理员',
    supervisor: '护士 / 主管',
    admin: '管理员',
    family: '家属',
  }[role]
  await page.getByRole('button', { name: new RegExp(label) }).click()
}
const mobile = await context.newPage()
await mobile.setViewportSize({ width: 390, height: 844 })
const admin = await context.newPage()
await admin.setViewportSize({ width: 1440, height: 1000 })
let newItem = ''
let newTask = ''
try {
  await test('真实IndexedDB：版本、账号隔离、文件恢复、并发与重置', async () => {
    await mobile.goto(`${base}/mobile/login`)
    const checks = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      await core.resetDemo()
      const editor = core.createRecordEditor('api', 'test-a', 'elder-1')
      editor.text = '已保存的原文'
      editor.editVersion = 2
      await core.saveRecordEditor(editor)
      let conflict = false
      try {
        await core.saveRecordEditor({
          ...editor,
          text: '旧版本',
          editVersion: 1,
        })
      } catch {
        conflict = true
      }
      const latest = await core.loadRecordEditor(
        'api',
        'test-a',
        editor.localId,
      )
      core.writeRecordJournal({
        ...editor,
        text: '刷新前最后输入',
        editVersion: 3,
        phase: 'submitting',
      })
      const recovered = await core.loadRecordEditor(
        'api',
        'test-a',
        editor.localId,
      )
      const isolated = await core.loadRecordEditor(
        'api',
        'test-b',
        editor.localId,
      )
      const form = core.createTaskEditor('task-file', 'api', 'test-a')
      form.attachments = [
        new File(['proof'], 'proof.txt', { type: 'text/plain' }),
      ]
      await core.saveTaskEditor(form)
      const restored = await core.loadTaskEditor('api', 'test-a', 'task-file')
      const claims = await Promise.all([
        core.claimWriteAttempt('test-lock'),
        core.claimWriteAttempt('test-lock'),
      ])
      await core.finishWriteAttempt('test-lock')
      const before = await core.loadDemoState()
      await Promise.all([
        core.updateDemoState(before.epoch, (state) =>
          state.notifications.push('A'),
        ),
        core.updateDemoState(before.epoch, (state) =>
          state.notifications.push('B'),
        ),
      ])
      const concurrent = await core.loadDemoState()
      const stale = core.createRecordEditor('demo', 'test-a', 'elder-101-wang')
      stale.demoEpoch = before.epoch
      stale.text = '观察'
      stale.review.observation = '观察'
      const handover = core.createHandoverEditor('demo', 'test-a', 'late')
      handover.demoEpoch = before.epoch
      handover.version = 1
      handover.note = 'v1'
      await core.saveHandoverEditor(handover)
      handover.version = 2
      handover.note = 'v2'
      await core.saveHandoverEditor(handover)
      const versions = await core.listHandoverEditors('demo', 'test-a', 'late')
      await core.resetDemo()
      let rejected = false
      try {
        await core.saveDemoManualRecord(stale)
      } catch {
        rejected = true
      }
      const livePreserved = await core.loadRecordEditor(
        'api',
        'test-a',
        editor.localId,
      )
      let staleSaved = false
      try {
        await core.saveRecordEditor(stale)
      } catch {
        staleSaved = true
      }
      return {
        conflict,
        latest: latest?.text,
        recovered: recovered?.text,
        phase: recovered?.phase,
        isolated: !isolated,
        file: await restored.attachments[0].text(),
        claims: claims.filter(Boolean).length,
        concurrent:
          concurrent.notifications.includes('A') &&
          concurrent.notifications.includes('B'),
        versions: versions.map((item) => item.note).sort(),
        rejected,
        staleSaved,
        livePreserved: Boolean(livePreserved),
      }
    })
    assert.deepEqual(checks, {
      conflict: true,
      latest: '已保存的原文',
      recovered: '刷新前最后输入',
      phase: 'uncertain',
      isolated: true,
      file: 'proof',
      claims: 1,
      concurrent: true,
      versions: ['v1', 'v2'],
      rejected: true,
      staleSaved: true,
      livePreserved: true,
    })
  })
  await test('同源双端独立身份与移动端草稿刷新恢复', async () => {
    await loginMobile(mobile)
    await admin.goto(`${base}/admin/login`)
    await admin.getByRole('button', { name: /护士 \/ 主管/ }).click()
    await text(admin, '主管')
    await mobile.goto(`${base}/mobile/records/new`)
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        '午餐只吃一半，晚上联系女儿。',
    )
    await mobile.locator('textarea').first().fill('刷新后应保留的最后原文')
    await mobile.reload()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value === '刷新后应保留的最后原文',
    )
    assert.equal(
      await mobile.evaluate(
        () => JSON.parse(sessionStorage.getItem('hulao:session:v2')).role,
      ),
      'caregiver',
    )
    assert.equal(
      await admin.evaluate(
        () => JSON.parse(sessionStorage.getItem('hulao:session:v2')).role,
      ),
      'supervisor',
    )
    await noOverflow(mobile)
    await mobile.screenshot({
      path: resolve(output, 'mobile-record-390.png'),
      fullPage: true,
    })
  })
  await test('一个窗口保存不会清除另一个窗口较低版本的未保存原文', async () => {
    const original = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const editor = core.createRecordEditor(
        'api',
        'journal-test',
        'elder-test',
      )
      editor.text = '初稿'
      editor.editVersion = 1
      await core.saveRecordEditor(editor)
      return editor
    })
    const latest = await mobile.evaluate(async (editor) => {
      const core = await import('/packages/shared/src/index.ts')
      editor.text = '已经提交本机的高版本'
      editor.editVersion = 10
      await core.saveRecordEditor(editor)
      return editor
    }, original)
    await admin.evaluate(async (editor) => {
      const core = await import('/packages/shared/src/index.ts')
      editor.text = '另一个窗口较低版本但未保存的原文'
      editor.editVersion = 2
      core.writeRecordJournal(editor)
    }, original)
    await mobile.evaluate(async (editor) => {
      const core = await import('/packages/shared/src/index.ts')
      await core.saveRecordEditor(editor)
    }, latest)
    const recovered = await admin.evaluate(async (id) => {
      const core = await import('/packages/shared/src/index.ts')
      return (await core.loadRecordEditor('api', 'journal-test', id))?.text
    }, original.localId)
    assert.equal(recovered, '另一个窗口较低版本但未保存的原文')
    const foreign = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      return (await core.listRecordEditors('api', 'journal-test'))
        .filter((item) => item.recoveredFrom)
        .map((item) => item.text)
    })
    assert.ok(foreign.includes('另一个窗口较低版本但未保存的原文'))
  })
  await test('共用草稿保存冲突可另存，旧副本不能用更高版本覆盖', async () => {
    await mobile.getByRole('button', { name: /保存本机/ }).click()
    await text(mobile, '已保存到本机')
    await admin.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const [editor] = await core.listRecordEditors('demo', 'demo-caregiver')
      editor.text = '其他窗口已经保存的内容'
      core.touchRecordEditor(editor, true)
      await core.saveRecordEditor(editor)
    })
    await mobile.locator('textarea').first().fill('本窗口连续编辑第一遍')
    await mobile
      .locator('textarea')
      .first()
      .fill('本窗口连续编辑第二遍，必须保留')
    await mobile.getByRole('button', { name: /保存本机/ }).click()
    await text(mobile, '草稿保存冲突')
    await mobile.getByRole('button', { name: '另存当前内容' }).click()
    await text(mobile, '当前内容已另存为新草稿')
    assert.equal(
      await mobile.locator('textarea').first().inputValue(),
      '本窗口连续编辑第二遍，必须保留',
    )
    const texts = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      return (await core.listRecordEditors('demo', 'demo-caregiver')).map(
        (item) => item.text,
      )
    })
    assert.ok(texts.includes('其他窗口已经保存的内容'))
    assert.ok(texts.includes('本窗口连续编辑第二遍，必须保留'))
  })
  await test('原文变化使AI失效，人工确认只生成一次任务', async () => {
    await admin.goto(`${base}/admin/tasks`)
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        '午餐只吃一半，晚上联系女儿。',
    )
    await mobile.getByRole('button', { name: '提取AI草稿' }).click()
    await text(mobile, '人工核对')
    await mobile.locator('textarea').first().fill('修改后的原文')
    assert.equal(
      await mobile
        .getByRole('button', { name: '确认并提交', exact: true })
        .isDisabled(),
      true,
    )
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.getByRole('button', { name: '提取AI草稿' }).click()
    await mobile
      .getByRole('button', { name: '确认并提交', exact: true })
      .click()
    await mobile.getByRole('button', { name: '确认', exact: true }).click()
    await text(mobile, '演示记录已确认')
    const result = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const state = await core.loadDemoState()
      const task = state.tasks.find((item) => item.sourceDraftId)
      const draft = state.drafts.find((item) => item.id === task.sourceDraftId)
      await core
        .createDemoApi()
        .confirmRecord(draft.id, { fields: draft.fields })
      const next = await core.loadDemoState()
      return {
        id: task.id,
        item: task.itemId,
        count: next.tasks.filter((item) => item.sourceDraftId === draft.id)
          .length,
      }
    })
    assert.equal(result.count, 1)
    newItem = result.item
    newTask = result.id
    await text(admin, '晚上联系女儿')
  })
  await test('交班编辑版本、另一窗口接班与澄清', async () => {
    await mobile.goto(
      `${base}/mobile/handover?shift=${encodeURIComponent('晚班')}`,
    )
    await mobile.getByRole('checkbox', { name: '晚上联系女儿' }).check()
    await mobile.getByRole('button', { name: '提交演示交班' }).click()
    await text(mobile, '演示交班已提交')
    const receiving = await context.newPage()
    await receiving.setViewportSize({ width: 390, height: 844 })
    await loginMobile(receiving)
    await receiving.goto(
      `${base}/mobile/handover?shift=${encodeURIComponent('晚班')}`,
    )
    await receiving.getByRole('tab', { name: '接班', exact: true }).click()
    await text(receiving, '晚上联系女儿')
    await receiving.getByRole('button', { name: '提交澄清' }).click()
    await text(receiving, '请填写需要澄清的内容')
    await receiving.locator('textarea:visible').fill('请确认联系号码')
    await receiving.getByRole('button', { name: '提交澄清' }).click()
    await text(receiving, '需澄清')
    await receiving.getByRole('button', { name: '接收', exact: true }).click()
    await text(receiving, '已接收')
    await noOverflow(receiving)
    await receiving.screenshot({
      path: resolve(output, 'mobile-handover-390.png'),
      fullPage: true,
    })
    await receiving.close()
  })
  await test('完成任务、主管按事项回放同步', async () => {
    await admin.goto(`${base}/admin/timeline/${newItem}`)
    await text(admin, '接班接收')
    await mobile.goto(`${base}/mobile/tasks/${newTask}`)
    await mobile
      .getByRole('textbox', { name: '完成结果' })
      .fill('已与女儿联系，说明午餐情况。')
    await mobile.getByRole('button', { name: '提交演示操作' }).click()
    await text(mobile, '演示操作已保存')
    for (const label of ['人工确认', '交班', '接班接收', '执行完成'])
      await text(admin, label)
    await noOverflow(admin)
    await admin.screenshot({
      path: resolve(output, 'admin-timeline-1440.png'),
      fullPage: true,
    })
    await admin.setViewportSize({ width: 390, height: 844 })
    await noOverflow(admin)
    await admin.screenshot({
      path: resolve(output, 'admin-timeline-390.png'),
      fullPage: true,
    })
  })
  await test('家属不能通过直接地址进入内部记录', async () => {
    const family = await context.newPage()
    await loginMobile(family, 'family')
    await family.goto(`${base}/mobile/records/new`)
    await family.waitForURL('**/mobile/family')
    await family.getByRole('heading', { name: '王爷爷的日常' }).waitFor()
    assert.equal(
      await family.getByRole('button', { name: '提取AI草稿' }).count(),
      0,
    )
    await family.close()
  })
  await test('重置拒绝旧编辑器，新建后可以继续提取', async () => {
    await mobile.goto(`${base}/mobile/records/new`)
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        '午餐只吃一半，晚上联系女儿。',
    )
    await mobile.getByRole('button', { name: /保存本机/ }).click()
    await text(mobile, '已保存到本机')
    await admin.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      await core.resetDemo()
    })
    await mobile.getByRole('button', { name: '提取AI草稿' }).click()
    await text(mobile, '演示数据已重置')
    await mobile.getByRole('button', { name: /新草稿/ }).click()
    await mobile.waitForFunction(
      () => document.querySelector('textarea')?.value === '',
    )
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        '午餐只吃一半，晚上联系女儿。',
    )
    await mobile.getByRole('button', { name: '提取AI草稿' }).click()
    await text(mobile, '人工核对')
  })
  if (process.env.API_ADMIN_URL)
    await test('正式模式500无演示回退，403与401反馈', async () => {
      const live = await context.newPage()
      await live.goto(process.env.API_ADMIN_URL)
      await live.evaluate(() =>
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'test-supervisor',
            role: 'supervisor',
            accessToken: 'test-token',
          }),
        ),
      )
      let status = 500
      await live.route('**/api/**', (route) =>
        route.fulfill({ status, contentType: 'application/json', body: '{}' }),
      )
      await live.goto(new URL('/elders', process.env.API_ADMIN_URL).href)
      await text(live, '服务暂时不可用')
      assert.equal(await live.getByText('王阿姨').count(), 0)
      status = 403
      await live.reload()
      await text(live, '没有访问权限')
      status = 401
      await live.reload()
      await live.waitForURL('**/login')
      assert.equal(
        await live.evaluate(() => sessionStorage.getItem('hulao:session:v2')),
        null,
      )
      await live.close()
    })
  if (process.env.API_MOBILE_URL)
    await test('正式写请求失败保留原文，刷新后禁止重复提交', async () => {
      const live = await context.newPage()
      await live.setViewportSize({ width: 390, height: 844 })
      await live.goto(process.env.API_MOBILE_URL)
      await live.evaluate(() =>
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'test-caregiver',
            role: 'caregiver',
            accessToken: 'test-token',
          }),
        ),
      )
      let confirms = 0
      await live.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        const body = route.request().postDataJSON()
        let data = []
        if (path.endsWith('/elders'))
          data = [
            {
              id: 'e-live',
              name: '测试老人',
              bedLabel: '101床',
              status: '入住',
            },
          ]
        if (path.endsWith('/extract'))
          data = {
            id: 'draft-live',
            elderId: 'e-live',
            originalText: body.text,
            fields: {
              observation: '测试观察',
              followUp: '',
              contactTarget: '',
            },
            evidence: [body.text],
            warnings: [],
            status: 'pending_review',
          }
        if (path.endsWith('/confirm')) {
          confirms++
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{}',
          })
          return
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      })
      await live.goto(new URL('/records/new', process.env.API_MOBILE_URL).href)
      await live.getByLabel(/^老人/).selectOption('e-live')
      await live.locator('textarea').first().fill('正式模式测试原文')
      await live.getByRole('button', { name: '提取AI草稿' }).click()
      await live
        .getByRole('button', { name: '确认并提交', exact: true })
        .click()
      await live.getByRole('button', { name: '确认', exact: true }).click()
      await text(live, '提交结果待核实')
      assert.equal(confirms, 1)
      await live.reload()
      await text(live, '结果待核实')
      assert.equal(
        await live.locator('textarea').first().inputValue(),
        '正式模式测试原文',
      )
      assert.equal(
        await live
          .getByRole('button', { name: '确认并提交', exact: true })
          .isDisabled(),
        true,
      )
      assert.equal(confirms, 1)
      await live.close()
    })
  if (process.env.PREVIEW_URL)
    await test('静态构建双端深层地址与资源加载', async () => {
      const preview = await context.newPage()
      const root = process.env.PREVIEW_URL
      await preview.goto(`${root}/admin/elders`)
      await preview.getByRole('button', { name: /护士 \/ 主管/ }).click()
      await text(preview, '主管')
      await preview.goto(`${root}/admin/elders`)
      await text(preview, '王阿姨')
      const previewMobile = await context.newPage()
      await previewMobile.goto(`${root}/mobile/records/new`)
      await previewMobile.getByRole('button', { name: /护理员/ }).click()
      await previewMobile.goto(`${root}/mobile/records/new`)
      await previewMobile.getByRole('button', { name: '使用演示原文' }).click()
      await previewMobile.waitForFunction(
        () =>
          document.querySelector('textarea')?.value ===
          '午餐只吃一半，晚上联系女儿。',
      )
      await preview.close()
      await previewMobile.close()
    })
  await test('所有页面没有未捕获的运行时异常', async () =>
    assert.deepEqual(runtimeErrors, []))
} finally {
  await browser.close()
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  )
}
if (results.some((result) => !result.passed)) process.exitCode = 1

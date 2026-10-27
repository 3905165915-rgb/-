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
      const stale = core.createRecordEditor('demo', 'test-a', 'elder-wang-101')
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
        '今天想休息，下午活动前先问我，声音小一点。',
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
  await test('原文变化使整理失效；确认只保存一次记录；后续任务须人工补全', async () => {
    await admin.goto(`${base}/admin/tasks`)
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.getByRole('button', { name: '保存并查看整理结果' }).click()
    await text(mobile, '整理结果（待核对）')
    await mobile.locator('textarea').first().fill('修改后的原文')
    assert.equal(
      await mobile
        .getByRole('button', { name: '确认并提交', exact: true })
        .isDisabled(),
      true,
    )
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.getByRole('button', { name: '保存并查看整理结果' }).click()
    await mobile
      .getByRole('button', { name: '确认并提交', exact: true })
      .click()
    await mobile.locator('.van-dialog__confirm').click()
    await text(mobile, '记录已确认并保存到本机')
    const result = await mobile.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const { createDemoTask } =
        await import('/packages/shared/src/demo-task-create.ts')
      const state = await core.loadDemoState()
      const draft = state.drafts.find((item) => item.status === 'confirmed')
      const record = state.confirmedDrafts[draft.id]
      await core
        .createDemoApi()
        .confirmRecord(draft.id, {
          fields: draft.fields,
          demoEpoch: state.epoch,
        })
      const next = await core.loadDemoState()
      const day = next.demoDay
      const input = {
        epoch: state.epoch,
        operationKey: 'regression-followup',
        elderId: draft.elderId,
        sourceRecordId: record.record_id,
        title: '活动前询问本人意愿',
        executionAt: `${day}T19:00:00+08:00`,
        deadlineAt: `${day}T19:30:00+08:00`,
        assignee: '小王',
        shiftName: '晚班',
        scene: 'activity',
        confirmed: true,
      }
      const task = await createDemoTask(input)
      await createDemoTask(input)
      const after = await core.loadDemoState()
      return {
        id: task.id,
        item: task.itemId,
        records: next.records.filter((item) => item.id === record.record_id)
          .length,
        unchanged: next.tasks.length === state.tasks.length,
        count: after.tasks.filter((item) => item.id === task.id).length,
      }
    })
    assert.equal(result.records, 1)
    assert.equal(result.unchanged, true)
    assert.equal(result.count, 1)
    newItem = result.item
    newTask = result.id
    await text(admin, '活动前询问本人意愿')
  })
  await test('交班编辑版本、另一窗口接班与澄清', async () => {
    await mobile.goto(
      `${base}/mobile/handover?shift=${encodeURIComponent('晚班')}`,
    )
    await mobile.getByRole('checkbox', { name: '活动前询问本人意愿' }).check()
    await mobile.getByRole('button', { name: '提交演示交班' }).click()
    await text(mobile, '演示交班已提交')
    const receiving = await context.newPage()
    await receiving.setViewportSize({ width: 390, height: 844 })
    await loginMobile(receiving)
    await receiving.goto(
      `${base}/mobile/handover?shift=${encodeURIComponent('晚班')}`,
    )
    await receiving.getByRole('tab', { name: '接班', exact: true }).click()
    await text(receiving, '活动前询问本人意愿')
    await receiving
      .locator('.receive-item')
      .filter({ hasText: '活动前询问本人意愿' })
      .getByRole('button', { name: '提交澄清' })
      .click()
    await text(receiving, '请填写需要澄清的内容')
    await receiving
      .locator('.receive-item')
      .filter({ hasText: '活动前询问本人意愿' })
      .locator('textarea')
      .fill('请确认当次意愿')
    await receiving
      .locator('.receive-item')
      .filter({ hasText: '活动前询问本人意愿' })
      .getByRole('button', { name: '提交澄清' })
      .click()
    await text(receiving, '需澄清')
    await receiving
      .locator('.receive-item')
      .filter({ hasText: '活动前询问本人意愿' })
      .getByRole('button', { name: '接收', exact: true })
      .click()
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
    await mobile.getByRole('button', { name: '开始服务', exact: true }).click()
    await mobile
      .getByRole('button', { name: '填写下一操作', exact: true })
      .click()
    await mobile
      .getByRole('textbox', { name: '服务结果' })
      .fill('已与女儿联系，说明午餐情况。')
    await mobile.getByRole('button', { name: '登记结果', exact: true }).click()
    await text(mobile, '演示操作已保存')
    for (const label of [
      '来源记录',
      '人工新建任务',
      '交班',
      '接班接收',
      '执行完成',
    ])
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
    await family.getByText('王爷爷', { exact: false }).first().waitFor()
    assert.equal(
      await family.getByRole('button', { name: '保存并查看整理结果' }).count(),
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
        '今天想休息，下午活动前先问我，声音小一点。',
    )
    await mobile.getByRole('button', { name: /保存本机/ }).click()
    await text(mobile, '已保存到本机')
    await admin.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      await core.resetDemo()
    })
    await mobile.getByRole('button', { name: '保存并查看整理结果' }).click()
    await text(mobile, '演示数据已重置')
    await mobile.getByRole('button', { name: /新草稿/ }).click()
    await mobile.waitForFunction(
      () => document.querySelector('textarea')?.value === '',
    )
    await mobile.getByRole('button', { name: '使用演示原文' }).click()
    await mobile.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        '今天想休息，下午活动前先问我，声音小一点。',
    )
    await mobile.getByRole('button', { name: '保存并查看整理结果' }).click()
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
      await live.goto(new URL('elders', process.env.API_ADMIN_URL).href)
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
    await test('正式原文失败恢复、同编号重试和分析回执刷新恢复', async () => {
      const live = await context.newPage()
      await live.setViewportSize({ width: 390, height: 844 })
      const errors = []
      live.on('pageerror', (error) => errors.push(error.message))
      await live.goto(process.env.API_MOBILE_URL)
      await live.evaluate(() =>
        sessionStorage.setItem(
          'hulao:session:v2',
          JSON.stringify({
            mode: 'api',
            accountKey: 'test-caregiver',
            userId: 'staff-live',
            role: 'caregiver',
            accessToken: 'test-token',
          }),
        ),
      )
      const attempts = []
      let analyses = 0
      const confirmations = []
      const record = {
        id: 'record-live',
        elder_id: 'e-live',
        status: 'confirmed',
        revision: 1,
        raw_text: '正式模式测试原文',
        admission_id: 'adm-live',
        created_at: '2026-10-27T10:00:00+08:00',
        happened_at: null,
      }
      await live.route('**/api/**', async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname
        let data = []
        if (path.endsWith('/elders'))
          data = [
            {
              id: 'e-live',
              name: '虚构测试老人',
              status: 'active',
              current_admission_id: 'adm-live',
              bed_id: 'bed-live',
              bed_label: '101床',
              revision: 1,
            },
          ]
        if (path.endsWith('/e-live/record') && req.method() === 'POST') {
          attempts.push({
            key: req.headers()['idempotency-key'],
            body: req.postDataJSON(),
          })
          if (attempts.length === 1) {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{}',
            })
            return
          }
          data = {
            record,
            analysis_status: 'failed',
            analysis: null,
            analysis_error: { code: 'timeout', message: '分析暂未完成' },
          }
        }
        if (path.endsWith('/analysis/analysis-live/confirm')) {
          confirmations.push({
            key: req.headers()['idempotency-key'],
            body: req.postDataJSON(),
          })
          if (confirmations.length === 1) {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{}',
            })
            return
          }
          data = { record, tasks: [], memories: [] }
        }
        if (path.endsWith('/records/record-live/analyze')) {
          analyses++
          data = {
            record,
            analysis_status: 'ready',
            analysis: {
              id: 'analysis-live',
              record_id: record.id,
              record_revision: 1,
              status: 'ready',
              scene: { value: null, citation: null },
              observations: [],
              task_suggestions: [],
              preference_suggestions: [],
              created_at: record.created_at,
            },
          }
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      })
      await live.goto(
        new URL('records/new?elder=e-live', process.env.API_MOBILE_URL).href,
      )
      await live.getByLabel('本次记录', { exact: true }).fill(record.raw_text)
      await live
        .getByRole('button', { name: '保存并分析', exact: true })
        .click()
      await text(live, '原提交已锁定')
      assert.equal(attempts.length, 1)
      await live.reload()
      await text(live, '原提交已锁定')
      assert.equal(
        await live.getByLabel('本次记录', { exact: true }).inputValue(),
        record.raw_text,
      )
      assert.equal(
        await live.getByLabel('本次记录', { exact: true }).isDisabled(),
        true,
      )
      assert.equal(attempts.length, 1)
      await live
        .getByRole('button', { name: '核实并重试原提交', exact: true })
        .click()
      await text(live, '正式记录已保存，分析失败')
      assert.equal(attempts.length, 2)
      assert.ok(attempts[0].key)
      assert.deepEqual(attempts[0], attempts[1])
      await live.reload()
      await text(live, '已恢复上次服务器回执')
      await live
        .getByRole('button', { name: '重试此记录分析', exact: true })
        .click()
      await text(live, '同一记录的分析已恢复')
      assert.equal(analyses, 1)
      assert.equal(attempts.length, 2)
      await live.reload()
      await text(live, '已恢复上次服务器回执')
      await live
        .getByRole('button', { name: '保存本次核对', exact: true })
        .click()
      await live
        .getByRole('button', { name: '核实并重试原核对', exact: true })
        .waitFor()
      assert.equal(confirmations.length, 1)
      await live.reload()
      await live
        .getByRole('button', { name: '核实并重试原核对', exact: true })
        .click()
      await text(live, '本次核对已保存')
      assert.deepEqual(confirmations[0], confirmations[1])
      assert.equal(confirmations.length, 2)
      await live.reload()
      await live
        .locator('.workspace-badge')
        .filter({ hasText: '已核对' })
        .waitFor()
      assert.equal(
        await live
          .getByRole('button', { name: '保存本次核对', exact: true })
          .count(),
        0,
      )
      assert.equal(confirmations.length, 2)
      assert.equal(analyses, 1)
      assert.equal(attempts.length, 2)
      assert.deepEqual(errors, [])
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
      await text(preview, '王爷爷')
      const previewMobile = await context.newPage()
      await previewMobile.goto(`${root}/mobile/records/new`)
      await previewMobile.getByRole('button', { name: /护理员/ }).click()
      await previewMobile.goto(`${root}/mobile/records/new`)
      await previewMobile.getByRole('button', { name: '使用演示原文' }).click()
      await previewMobile.waitForFunction(
        () =>
          document.querySelector('textarea')?.value ===
          '今天想休息，下午活动前先问我，声音小一点。',
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

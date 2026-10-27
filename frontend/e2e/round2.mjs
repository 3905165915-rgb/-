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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
context.setDefaultTimeout(15000)
const results = []
const errors = []
context.on('page', (page) =>
  page.on('pageerror', (error) => errors.push(error.message)),
)
const page = await context.newPage()
const sibling = await context.newPage()
async function test(name, run) {
  try {
    await run()
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: String(error.stack ?? error),
      body: await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    })
    await page
      .screenshot({
        path: resolve(output, `round2-failure-${results.length}.png`),
        fullPage: true,
      })
      .catch(() => {})
    console.error('FAIL ' + name + ': ' + error.message)
  }
}
async function login(target, app = 'mobile') {
  await target.goto(`${base}/${app}/login`)
  await target
    .getByRole('button', {
      name: app === 'mobile' ? /护理员/ : /护士 \/ 主管/,
    })
    .click()
}
async function noOverflow(target) {
  assert.equal(
    await target.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  )
}
let taskId
try {
  await test('v1数据库无损升级，旧任务和提交保护记录保留', async () => {
    const isolated = await browser.newContext()
    const migration = await isolated.newPage()
    await migration.goto(`${base}/mobile/login`)
    const migrated = await migration.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('hulao-frontend-v2', 1)
        request.onupgradeneeded = () => {
          for (const name of [
            'recordEditors',
            'taskEditors',
            'handoverEditors',
            'writeAttempts',
            'demoState',
          ])
            request.result.createObjectStore(name)
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(
            ['taskEditors', 'writeAttempts'],
            'readwrite',
          )
          tx.objectStore('taskEditors').put(
            {
              taskId: 'legacy',
              mode: 'api',
              accountKey: 'old',
              action: 'complete',
              result: '旧结果',
              reason: '',
              transferTo: '',
              note: '',
              attachments: [],
              idempotencyKey: 'old-lock',
            },
            JSON.stringify(['api', 'old', 'legacy']),
          )
          tx.objectStore('writeAttempts').put({ id: 'old-lock' }, 'old-lock')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
      const core = await import('/packages/shared/src/index.ts')
      const draft = await core.loadTaskEditor('api', 'old', 'legacy')
      draft.result = '升级后修改'
      core.touchWorking(draft)
      await core.saveTaskEditor(draft)
      return {
        version: (await core.openDatabase()).version,
        result: (await core.loadTaskEditor('api', 'old', 'legacy')).result,
        locked: await core.hasWriteAttempt('old-lock'),
      }
    })
    assert.deepEqual(migrated, {
      version: 2,
      result: '升级后修改',
      locked: true,
    })
    await isolated.close()
  })
  await login(page)
  await sibling.goto(`${base}/mobile/login`)
  await test('交班最后输入刷新恢复，前进后退切班不丢稿且不增加历史版本', async () => {
    await page.goto(`${base}/mobile/handover?shift=round2-A`)
    const note = page.getByRole('textbox', { name: '交班备注' })
    await note.fill('A班刷新前最后输入')
    await page.reload()
    await note.waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('textarea')].some(
        (el) => el.value === 'A班刷新前最后输入',
      ),
    )
    await page.getByRole('textbox', { name: '交接班次' }).fill('round2-B')
    await page.getByRole('button', { name: '载入', exact: true }).click()
    await page.waitForURL('**shift=round2-B')
    await note.fill('B班不同的内容')
    await page.goBack()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('textarea')].some(
        (el) => el.value === 'A班刷新前最后输入',
      ),
    )
    await page.goForward()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('textarea')].some(
        (el) => el.value === 'B班不同的内容',
      ),
    )
    const versions = await page.evaluate(
      async () =>
        (
          await (
            await import('/packages/shared/src/index.ts')
          ).listHandoverEditors('demo', 'demo-caregiver', 'round2-B')
        ).length,
    )
    assert.equal(versions, 0)
    await noOverflow(page)
    await page.screenshot({
      path: resolve(output, 'round2-handover-390.png'),
      fullPage: true,
    })
  })
  await test('任务文字立即刷新恢复，文件落盘后可恢复内容', async () => {
    taskId = await page.evaluate(
      async () =>
        (
          await (await import('/packages/shared/src/index.ts')).loadDemoState()
        ).tasks.find((task) => task.status === 'in_progress').id,
    )
    await page.goto(`${base}/mobile/tasks/${encodeURIComponent(taskId)}`)
    await page
      .getByRole('textbox', { name: '服务结果' })
      .fill('任务刷新前最后输入')
    await page.reload()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('textarea')].some(
        (el) => el.value === '任务刷新前最后输入',
      ),
    )
    await page.locator('input[type=file]').setInputFiles({
      name: 'round2-proof.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('round2-file-proof'),
    })
    await page
      .locator('.save-status')
      .filter({ hasText: '已保存到本机' })
      .waitFor()
    await page.reload()
    const text = await page.evaluate(async (id) => {
      const core = await import('/packages/shared/src/index.ts')
      return (
        await core.loadTaskEditor('demo', 'demo-caregiver', id)
      ).attachments[0].text()
    }, taskId)
    assert.equal(text, 'round2-file-proof')
    await page.getByText('round2-proof.txt', { exact: false }).waitFor()
    await noOverflow(page)
    await page.screenshot({
      path: resolve(output, 'round2-task-390.png'),
      fullPage: true,
    })
  })
  await test('任务两窗口CAS冲突可另存，原保存内容不被覆盖', async () => {
    const activeId = await page.evaluate(
      async (id) =>
        (
          await (
            await import('/packages/shared/src/index.ts')
          ).loadTaskEditor('demo', 'demo-caregiver', id)
        ).localId,
      taskId,
    )
    await sibling.evaluate(
      async ({ id, activeId }) => {
        const core = await import('/packages/shared/src/index.ts')
        const form = await core.loadTaskEditor(
          'demo',
          'demo-caregiver',
          id,
          activeId,
        )
        form.result = '另一窗口已保存的结果'
        core.touchWorking(form)
        await core.saveTaskEditor(form)
      },
      { id: taskId, activeId },
    )
    await page
      .getByRole('textbox', { name: '服务结果' })
      .fill('本窗口需要另存的结果')
    await page.getByRole('button', { name: '保存本机', exact: true }).click()
    await page.getByText(/草稿保存冲突/).waitFor()
    await page
      .getByRole('button', { name: '另存当前内容', exact: true })
      .click()
    await page.getByText('当前内容已另存为独立草稿。').waitFor()
    const rows = await page.evaluate(
      async (id) =>
        (
          await (
            await import('/packages/shared/src/index.ts')
          ).listWorkingDrafts('task', 'demo', 'demo-caregiver', id)
        ).map((row) => row.result),
      taskId,
    )
    assert.ok(rows.includes('另一窗口已保存的结果'))
    assert.ok(rows.includes('本窗口需要另存的结果'))
  })
  await test('未落盘附件不冒充恢复成功；提交阶段可恢复为待核实', async () => {
    const checks = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const form = core.createTaskEditor('missing-file', 'api', 'round2-core')
      form.result = '已填文字'
      form.attachments = [new File(['data'], 'not-yet-saved.txt')]
      core.touchWorking(form)
      core.writeWorkingJournal('task', form)
      const restored = await core.loadTaskEditor(
        'api',
        'round2-core',
        form.taskId,
      )
      const pending = core.createTaskEditor(
        'uncertain-task',
        'api',
        'round2-core',
      )
      pending.result = '待核实结果'
      pending.phase = 'submitting'
      core.touchWorking(pending)
      await core.saveTaskEditor(pending)
      await core.claimWriteAttempt(pending.idempotencyKey)
      const resumed = await core.loadTaskEditor(
        'api',
        'round2-core',
        pending.taskId,
      )
      const rows = await core.listLocalDrafts('api', 'round2-core')
      const protectedRow = rows.find((row) => row.id === pending.localId)
      let rejected = false
      try {
        await core.deleteLocalDrafts('api', 'round2-core', [protectedRow])
      } catch {
        rejected = true
      }
      return {
        text: restored.result,
        files: restored.attachments.length,
        missing: restored.missingAttachments,
        phase: resumed.phase,
        protected: protectedRow.protected,
        rejected,
        locked: await core.hasWriteAttempt(pending.idempotencyKey),
      }
    })
    assert.deepEqual(checks, {
      text: '已填文字',
      files: 0,
      missing: ['not-yet-saved.txt'],
      phase: 'uncertain',
      protected: true,
      rejected: true,
      locked: true,
    })
  })
  await test('逐条删除保留其他稿，删除标记阻止旧窗口及恢复日志回灌', async () => {
    const checks = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const form = core.createTaskEditor('delete-me', 'api', 'round2-delete')
      form.result = '可清理内容'
      await core.saveTaskEditor(form)
      const keep = core.createTaskEditor('keep-me', 'api', 'round2-delete')
      await core.saveTaskEditor(keep)
      const selected = (
        await core.listLocalDrafts('api', 'round2-delete')
      ).filter((row) => row.id === 'delete-me')
      await core.deleteLocalDrafts('api', 'round2-delete', selected)
      form.result = '旧窗口再次写入'
      core.touchWorking(form)
      let blocked = false
      try {
        await core.saveTaskEditor(form)
      } catch {
        blocked = true
      }
      core.writeWorkingJournal('task', form)
      const after = await core.listWorkingDrafts('task', 'api', 'round2-delete')
      const record = core.createRecordEditor('api', 'round2-delete', 'e-test')
      record.text = '只有恢复日志的记录'
      core.writeRecordJournal(record)
      const records = (
        await core.listLocalDrafts('api', 'round2-delete')
      ).filter((row) => row.store === 'recordEditors')
      await core.deleteLocalDrafts('api', 'round2-delete', records)
      core.writeRecordJournal(record)
      return {
        blocked,
        canonicalDeleted: !after.some((row) => row.localId === 'delete-me'),
        kept: after.some((row) => row.taskId === 'keep-me'),
        records: (await core.listRecordEditors('api', 'round2-delete')).length,
      }
    })
    assert.deepEqual(checks, {
      blocked: true,
      canonicalDeleted: true,
      kept: true,
      records: 0,
    })
  })
  await test('交班多窗口版本冲突、恢复分支和故障反馈', async () => {
    const checks = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const draft = core.createHandoverEditor('api', 'round2-handover', 's1')
      draft.localId = 's1'
      await core.saveWorkingDraft('handover', draft)
      const stale = structuredClone(draft)
      draft.note = '先保存的交班'
      core.touchWorking(draft)
      await core.saveWorkingDraft('handover', draft)
      stale.note = '冲突的交班'
      core.touchWorking(stale)
      let conflict = false
      try {
        await core.saveWorkingDraft('handover', stale)
      } catch {
        conflict = true
      }
      core.writeWorkingJournal('handover', stale)
      const recovered = await core.loadHandoverWorkingDraft(
        'api',
        'round2-handover',
        's1',
      )
      return {
        conflict,
        note: recovered.note,
        quota: core.storageFailure(
          new DOMException('full', 'QuotaExceededError'),
        ),
        denied: core.storageFailure(
          new DOMException('denied', 'SecurityError'),
        ),
      }
    })
    assert.equal(checks.conflict, true)
    assert.equal(checks.note, '冲突的交班')
    assert.match(checks.quota, /空间不足/)
    assert.match(checks.denied, /禁止本机存储/)
  })
  await test('同名同元数据附件不替换新文件，落盘后恢复正确字节', async () => {
    const checks = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const form = core.createTaskEditor('file-identity', 'api', 'round2-files')
      const options = { type: 'text/plain', lastModified: 123456 }
      form.attachments = [new File(['OLD!'], 'proof.txt', options)]
      await core.saveTaskEditor(form)
      const first = form.attachmentIds[0]
      form.attachments = [new File(['NEW!'], 'proof.txt', options)]
      core.touchWorking(form)
      core.writeWorkingJournal('task', form)
      const pending = await core.loadTaskEditor(
        'api',
        'round2-files',
        form.taskId,
      )
      const distinct = first !== form.attachmentIds[0]
      await core.saveTaskEditor(form)
      form.result = '文件保存后的文字'
      core.touchWorking(form)
      core.writeWorkingJournal('task', form)
      const saved = await core.loadTaskEditor(
        'api',
        'round2-files',
        form.taskId,
      )
      return {
        distinct,
        pendingFiles: pending.attachments.length,
        missing: pending.missingAttachments,
        bytes: await saved.attachments[0].text(),
        savedMissing: saved.missingAttachments,
      }
    })
    assert.deepEqual(checks, {
      distinct: true,
      pendingFiles: 0,
      missing: ['proof.txt'],
      bytes: 'NEW!',
      savedMissing: [],
    })
  })
  await test('确认删除后新出现的分支中止删除，晚到日志独立恢复', async () => {
    const checks = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const form = core.createTaskEditor('racy', 'api', 'round2-race')
      form.result = '原保存内容'
      await core.saveTaskEditor(form)
      const selected = await core.listLocalDrafts('api', 'round2-race')
      const branch = {
        ...form,
        result: '未选择的并发文字',
        editVersion: 1,
        attachmentHints: [],
      }
      const name =
        'hulao:working-journal:' +
        JSON.stringify(['task', 'api', 'round2-race', 'racy', 'racing-writer'])
      const original = IDBDatabase.prototype.transaction
      let injected = false
      let rejected = false
      IDBDatabase.prototype.transaction = function (stores, access, ...rest) {
        if (
          !injected &&
          access === 'readwrite' &&
          Array.isArray(stores) &&
          stores.includes('writeAttempts') &&
          stores.includes('draftDeletions')
        ) {
          injected = true
          localStorage.setItem(name, JSON.stringify(branch))
        }
        return original.call(this, stores, access, ...rest)
      }
      try {
        await core.deleteLocalDrafts('api', 'round2-race', selected)
      } catch {
        rejected = true
      } finally {
        IDBDatabase.prototype.transaction = original
      }
      const preserved = await core.listLocalDrafts('api', 'round2-race')
      let ancestorRejected = false
      try {
        await core.deleteLocalDrafts('api', 'round2-race', selected)
      } catch {
        ancestorRejected = true
      }
      await core.deleteLocalDrafts('api', 'round2-race', preserved)
      const removed = (await core.listLocalDrafts('api', 'round2-race')).length
      const late = {
        ...form,
        result: '删除检查后晚到的文字',
        editVersion: 2,
        attachmentHints: [],
      }
      const lateName =
        'hulao:working-journal:' +
        JSON.stringify(['task', 'api', 'round2-race', 'racy', 'late-writer'])
      localStorage.setItem(lateName, JSON.stringify(late))
      const after = await core.listLocalDrafts('api', 'round2-race')
      const canonicalBlocked = await core.saveTaskEditor(form).then(
        () => false,
        () => true,
      )
      return {
        injected,
        rejected,
        ancestorRejected,
        preserved: preserved.map((row) => row.title).sort(),
        removed,
        late: after.map((row) => row.title),
        independent: after.every((row) => row.id !== 'racy'),
        canonicalBlocked,
      }
    })
    assert.deepEqual(checks, {
      injected: true,
      rejected: true,
      ancestorRejected: true,
      preserved: ['原保存内容', '未选择的并发文字'].sort(),
      removed: 0,
      late: ['删除检查后晚到的文字'],
      independent: true,
      canonicalBlocked: true,
    })
  })
  await test('复制标签页使用独立日志标识，等版本和不同版本文字均保留', async () => {
    const isolated = await browser.newContext()
    const owner = await isolated.newPage()
    try {
      await owner.goto(`${base}/mobile/login`)
      const firstWriter = await owner.evaluate(async () =>
        (await import('/packages/shared/src/index.ts')).writerId(),
      )
      const childPromise = isolated.waitForEvent('page')
      await owner.evaluate(
        (url) => window.open(url, '_blank'),
        `${base}/mobile/login`,
      )
      const child = await childPromise
      await child.waitForLoadState()
      const secondWriter = await child.evaluate(async () =>
        (await import('/packages/shared/src/index.ts')).writerId(),
      )
      assert.notEqual(firstWriter, secondWriter)
      for (const [target, text, version] of [
        [owner, '窗口A最后输入', 1],
        [child, '窗口B最后输入', 1],
      ]) {
        await target.evaluate(
          async ({ text, version }) => {
            const core = await import('/packages/shared/src/index.ts')
            const draft = core.createTaskEditor(
              'opener',
              'api',
              'round2-opener',
            )
            draft.result = text
            draft.editVersion = version
            core.writeWorkingJournal('task', draft)
          },
          { text, version },
        )
      }
      await child.evaluate(async () => {
        const core = await import('/packages/shared/src/index.ts')
        const draft = await core.loadTaskEditor(
          'api',
          'round2-opener',
          'opener',
        )
        draft.result = '窗口B更高版本输入'
        core.touchWorking(draft)
        core.writeWorkingJournal('task', draft)
      })
      await owner.reload()
      await child.reload()
      const values = await owner.evaluate(async () =>
        (
          await (
            await import('/packages/shared/src/index.ts')
          ).listWorkingDrafts('task', 'api', 'round2-opener')
        )
          .map((row) => row.result)
          .sort(),
      )
      assert.deepEqual(values, ['窗口A最后输入', '窗口B更高版本输入'].sort())
    } finally {
      await isolated.close()
    }
  })
  await test('草稿管理界面可筛选，移动端布局无溢出', async () => {
    await page.getByRole('button', { name: '本机草稿', exact: true }).click()
    await page.locator('.draft-row').first().waitFor()
    await page.locator('.draft-popup select').first().selectOption('任务')
    await page.locator('.draft-popup input[type=search]').fill('本窗口需要另存')
    await page
      .locator('.draft-popup')
      .getByText('本窗口需要另存的结果', { exact: true })
      .first()
      .waitFor()
    await noOverflow(page)
    await page.screenshot({
      path: resolve(output, 'round2-drafts-390.png'),
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '关闭草稿管理' }).click()
  })
  await test('数百条任务分页、搜索、排序和重置，管理端与移动端无溢出', async () => {
    const loadedCount = await page.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const state = await core.loadDemoState()
      await core.updateDemoState(state.epoch, (value) => {
        const source = value.tasks[0]
        for (let index = 0; index < 320; index++)
          value.tasks.push({
            ...source,
            id: 'round2-load-' + index.toString().padStart(3, '0'),
            title: '压力测试任务 ' + index,
            dueAt: `2026-10-20T${String(8 + (index % 12)).padStart(2, '0')}:00:00`,
            status: 'pending',
          })
      })
      return (await core.loadDemoState()).tasks.length
    })
    const admin = await context.newPage()
    await admin.setViewportSize({ width: 1440, height: 1000 })
    await login(admin, 'admin')
    await admin.goto(`${base}/admin/tasks`)
    await admin.getByPlaceholder('已载入任务、老人、床位').fill('压力测试')
    await admin.waitForFunction(
      () => document.querySelectorAll('.el-table__body tbody tr').length === 25,
    )
    await admin
      .getByText(`当前 320 项 · 已载入 ${loadedCount} 项`, { exact: true })
      .waitFor()
    await admin.locator('.btn-next').click()
    await admin.getByRole('button', { name: '重置筛选' }).click()
    await noOverflow(admin)
    await admin.screenshot({
      path: resolve(output, 'round2-admin-tasks-1440.png'),
      fullPage: true,
    })
    await admin.evaluate(async () => {
      const core = await import('/packages/shared/src/index.ts')
      const state = await core.loadDemoState()
      const draft = core.createTaskEditor(
        state.tasks[0].id,
        'demo',
        'demo-supervisor',
      )
      draft.demoEpoch = state.epoch
      draft.result = '已核对午餐情况，继续观察进食量。'
      await core.saveTaskEditor(draft)
      const pending = core.createTaskEditor(
        'round2-admin-pending',
        'demo',
        'demo-supervisor',
      )
      pending.demoEpoch = state.epoch
      pending.result = '网络中断后的提交结果'
      pending.phase = 'uncertain'
      await core.saveTaskEditor(pending)
    })
    await admin.getByRole('button', { name: '本机草稿', exact: true }).click()
    await admin.getByRole('dialog').first().waitFor()
    await admin
      .getByText('已核对午餐情况，继续观察进食量。', { exact: true })
      .waitFor()
    await admin.getByText('提交保护中', { exact: true }).waitFor()
    assert.ok(
      await admin
        .locator('.draft-title')
        .first()
        .evaluate(
          (element) => parseFloat(getComputedStyle(element).fontSize) >= 12,
        ),
    )
    await noOverflow(admin)
    await admin.screenshot({
      path: resolve(output, 'round2-admin-drafts-1440.png'),
      animations: 'disabled',
    })
    await admin.setViewportSize({ width: 390, height: 844 })
    await noOverflow(admin)
    await admin.screenshot({
      path: resolve(output, 'round2-admin-drafts-390.png'),
      animations: 'disabled',
    })
    await admin.close()
    await page.goto(`${base}/mobile/caregiver`)
    await page.locator('input[type=search]').fill('压力测试')
    await page.getByText('当前 320 项', { exact: true }).waitFor()
    assert.equal(await page.locator('.task-row').count(), 30)
    await page.getByRole('button', { name: '显示更多' }).click()
    assert.equal(await page.locator('.task-row').count(), 60)
    await noOverflow(page)
  })
  await test('旧删除操作不跨演示重置删除同编号的新草稿', async () => {
    const isolated = await browser.newContext()
    const resetPage = await isolated.newPage()
    try {
      await resetPage.goto(`${base}/mobile/login`)
      const checks = await resetPage.evaluate(async () => {
        const core = await import('/packages/shared/src/index.ts')
        const state = await core.loadDemoState()
        const draft = core.createTaskEditor('epoch-race', 'demo', 'epoch-user')
        draft.demoEpoch = state.epoch
        draft.result = '重置前'
        await core.saveTaskEditor(draft)
        const selected = await core.listLocalDrafts('demo', 'epoch-user')
        const newEpoch = crypto.randomUUID()
        const original = IDBDatabase.prototype.transaction
        let injected = false
        let rejected = false
        IDBDatabase.prototype.transaction = function (stores, access, ...rest) {
          if (
            !injected &&
            access === 'readwrite' &&
            Array.isArray(stores) &&
            stores.includes('writeAttempts') &&
            stores.includes('draftDeletions')
          ) {
            injected = true
            const tx = original.call(
              this,
              ['demoState', 'taskEditors', 'draftDeletions'],
              'readwrite',
            )
            tx.objectStore('demoState').put(
              { ...state, epoch: newEpoch },
              'current',
            )
            tx.objectStore('draftDeletions').clear()
            tx.objectStore('taskEditors').put(
              { ...draft, result: '重置后的新稿', demoEpoch: newEpoch },
              core.draftKey('demo', 'epoch-user', 'epoch-race'),
            )
          }
          return original.call(this, stores, access, ...rest)
        }
        try {
          await core.deleteLocalDrafts('demo', 'epoch-user', selected)
        } catch {
          rejected = true
        } finally {
          IDBDatabase.prototype.transaction = original
        }
        const after = await core.listWorkingDrafts('task', 'demo', 'epoch-user')
        return {
          injected,
          rejected,
          values: after.map((row) => row.result),
          epochs: after.map((row) => row.demoEpoch === newEpoch),
          tombstones: (await core.deletedDraftKeys('taskEditors', newEpoch))
            .size,
        }
      })
      assert.deepEqual(checks, {
        injected: true,
        rejected: true,
        values: ['重置后的新稿'],
        epochs: [true],
        tombstones: 0,
      })
    } finally {
      await isolated.close()
    }
  })
  await test('新增流程无未捕获异常', async () => assert.deepEqual(errors, []))
} finally {
  await browser.close()
  await writeFile(
    resolve(output, 'round2-results.json'),
    JSON.stringify(results, null, 2),
  )
}
if (results.some((result) => !result.passed)) process.exitCode = 1

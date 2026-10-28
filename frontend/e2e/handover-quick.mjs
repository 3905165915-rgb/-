import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.HANDOVER_URL || 'http://127.0.0.1:5180'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'test-results/handover-quick'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = [],
  results = []
const at = Date.now(),
  hour = 3600000
const stamp = (offset) => new Date(at + offset * hour).toISOString()
const shift = (id, start, end, members = ['care']) => ({
  id,
  name: id === 'current' ? '当前班' : id === 'next' ? '下一班' : '远期班',
  start_at: stamp(start),
  end_at: stamp(end),
  status: 'open',
  caregiver_ids: members,
})
const shiftRows = [
  shift('distant', 100, 108),
  shift('next', 4, 12),
  shift('current', -4, 4),
]
const elder = {
  id: 'elder',
  name: '王爷爷',
  status: 'active',
  bed_label: '101房·1床',
}
const task = {
  id: 'task-source',
  elder_id: elder.id,
  elder_name: '王爷爷',
  title: '询问活动意愿',
  status: 'overdue',
  shift_id: 'current',
  assignee_name: '护理员',
  due_at: stamp(-1),
  assigned_to: 'care',
}

async function scenario(name, run, settings = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Chicago',
  })
  const writes = [],
    state = { handover: null, shifts: shiftRows, ...settings }
  await context.addInitScript(
    ({ saved }) => {
      sessionStorage.setItem(
        'hulao:session:v2',
        JSON.stringify({
          mode: 'api',
          accountKey: 'handover-fix',
          userId: 'care',
          role: 'caregiver',
          accessToken: 'synthetic',
        }),
      )
      if (saved)
        sessionStorage.setItem(
          'hulao:handover-quick:v1:' +
            JSON.stringify(['handover-fix', 'care', 'caregiver']),
          JSON.stringify(saved),
        )
    },
    { saved: settings.saved },
  )
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/v1', '')
    const send = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (req.method() === 'GET') {
      if (path === '/shifts') return send(state.shifts)
      if (path === '/staff')
        return send([{ id: 'care', display_name: '护理员', active: true }])
      if (path === '/elders') return send([elder])
      if (path === '/tasks')
        return send([
          task,
          {
            ...task,
            id: 'other-task',
            title: '另一个班次的任务',
            shift_id: 'distant',
          },
        ])
      if (path === '/handovers')
        return send(state.handover ? [state.handover] : [])
      if (path === '/handovers/ho') return send(state.handover)
      return send([])
    }
    const body = req.postDataJSON()
    writes.push({ path, body })
    if (path === '/handovers') {
      state.handover = {
        id: 'ho',
        ...body,
        status: 'draft',
        revision: 1,
        items: [],
        ai_summary: null,
      }
      return send(state.handover, 201)
    }
    if (path.endsWith('/refresh')) {
      state.handover = {
        ...state.handover,
        revision: state.handover.revision + 1,
        ai_summary: null,
        handover_suggestions: [],
      }
      return send(state.handover)
    }
    if (path.endsWith('/ai-summary')) {
      if (state.failAI) return send({ detail: 'AI unavailable' }, 503)
      state.handover = {
        ...state.handover,
        revision: state.handover.revision + 1,
        ai_summary: {
          text: body.text,
          points: [
            {
              text: body.text,
              citations: [{ source_id: 'handover-text', quote: body.text }],
            },
          ],
        },
        handover_suggestions: [],
      }
      return send(state.handover)
    }
    if (path.endsWith('/submit')) {
      state.handover = {
        ...state.handover,
        ...body,
        status: 'submitted',
        revision: state.handover.revision + 1,
      }
      return send(state.handover)
    }
    return send({})
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(base + '/mobile/handover')
    await page.getByRole('button', { name: '刷新班次' }).waitFor()
    await page
      .getByRole('button', { name: '刷新班次' })
      .isEnabled()
      .then(async (enabled) => {
        if (!enabled)
          await page.waitForFunction(
            () => !document.querySelector('[aria-label="刷新班次"]').disabled,
          )
      })
    await run({ page, writes, state })
    results.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    await page.screenshot({ path: output + '/failure.png', fullPage: true })
    console.error(await page.locator('body').innerText())
    throw error
  } finally {
    await context.close()
  }
}

try {
  await scenario(
    '远期班次排第一仍默认当前班，接班自动选下一班；不显示英文编号或其他班任务',
    async ({ page, writes }) => {
      assert.equal(await page.getByLabel('交出班次').inputValue(), 'current')
      assert.equal(await page.getByLabel('接入班次').inputValue(), 'next')
      const pending = page.getByRole('region', { name: '待接续任务' })
      assert.match(await pending.innerText(), /王爷爷.*护理员.*已逾期/s)
      assert.doesNotMatch(
        await pending.innerText(),
        /task-source|overdue|另一个班次的任务/,
      )
      await page.getByLabel('交班内容').fill('活动前再次询问本人意愿。')
      await page
        .getByRole('button', { name: '分析并核对', exact: true })
        .click()
      await page.getByLabel('摘要', { exact: true }).waitFor()
      await page.getByRole('button', { name: '核对并提交交班' }).click()
      await page
        .getByText('交班已提交，已有未完成任务沿用原编号接续。', {
          exact: true,
        })
        .waitFor()
      assert.equal(
        writes.filter((row) => row.path.endsWith('/submit')).length,
        1,
      )
      assert.equal(writes.at(-1).body.approve_ai_summary, true)
      await page.getByRole('button', { name: '开始下一次交班' }).waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      )
      await page.screenshot({
        path: output + '/submitted-mobile.png',
        fullPage: true,
      })
    },
  )
  await scenario(
    '错误旧草稿自动修正班次且保留文字；分析失败可人工核对提交',
    async ({ page, writes }) => {
      assert.equal(
        await page.getByLabel('交班内容').inputValue(),
        '王爷爷今天想自行决定午休时间。',
      )
      assert.equal(await page.getByLabel('交出班次').inputValue(), 'current')
      await page
        .getByRole('button', { name: '分析并核对', exact: true })
        .click()
      await page.getByRole('alert').filter({ hasText: '分析未完成' }).waitFor()
      assert.equal(
        writes.filter((row) => row.path.endsWith('/submit')).length,
        0,
      )
      await page
        .getByRole('button', { name: '人工核对交班', exact: true })
        .click()
      await page.getByLabel('摘要', { exact: true }).waitFor()
      await page.getByRole('button', { name: '核对并提交交班' }).click()
      await page
        .getByText('交班已提交，已有未完成任务沿用原编号接续。', {
          exact: true,
        })
        .waitFor()
      assert.equal(writes.at(-1).body.approve_ai_summary, false)
      assert.deepEqual(writes.at(-1).body.accepted_tasks, [])
    },
    {
      failAI: true,
      saved: {
        sourceShiftId: 'distant',
        targetShiftId: 'current',
        note: '王爷爷今天想自行决定午休时间。',
        handoverId: '',
      },
    },
  )
  await scenario(
    '只有一个班次时明确提示主管安排下一班',
    async ({ page }) => {
      await page.getByLabel('交班内容').fill('需继续了解本人意愿。')
      await page
        .getByText('尚未安排后续接班班次，请联系主管先安排下一班。', {
          exact: true,
        })
        .waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: '分析并核对', exact: true })
          .isDisabled(),
        true,
      )
    },
    { shifts: [shiftRows[2]] },
  )
  await scenario(
    '分析后改动原文不能误交旧摘要，更换班次保留输入',
    async ({ page }) => {
      await page.getByLabel('交班内容').fill('活动前询问本人意愿。')
      await page
        .getByRole('button', { name: '分析并核对', exact: true })
        .click()
      await page.getByLabel('摘要', { exact: true }).waitFor()
      await page.getByLabel('交班内容').fill('本人今天想休息，请下班再次确认。')
      assert.equal(
        await page.getByRole('button', { name: '核对并提交交班' }).isDisabled(),
        true,
      )
      await page
        .getByRole('button', { name: '更换班次（保留文字）', exact: true })
        .click()
      await page
        .getByRole('button', { name: '人工核对交班', exact: true })
        .waitFor()
      assert.equal(
        await page.getByLabel('交班内容').inputValue(),
        '本人今天想休息，请下班再次确认。',
      )
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="刷新班次"]').disabled,
      )
      assert.equal(await page.getByLabel('交出班次').isEnabled(), true)
    },
  )
  assert.deepEqual(errors, [])
  await writeFile(
    output + '/evidence.json',
    JSON.stringify({ results, errors }, null, 2),
  )
} finally {
  await browser.close()
}

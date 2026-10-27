# 老人记录即时分析、单页交班与时间线实施计划

> **For agentic workers:** Execute inline in the current session as the user authorized. Track the checkboxes and validate each deliverable before committing it.

**Goal:** 在老人工作页接入记录即时 AI 分析和一次核对，把交班收敛到单页，并让老人时间线按服务器登记时间倒序展示。

**Architecture:** FastAPI 先持久化正式记录，再在文件锁外调用 AI，并校验来源后保存分析；旧记录分析作业停止消费并迁移成可见失败状态。Vue 共享工作区连接文字、语音、照片、分析核对和交班流程；时间线 API 以服务器审计时间提供稳定分页和日期分组。

**Tech Stack:** Python 3、FastAPI、Pydantic、JSON store；Vue 3、TypeScript、Vant、Element Plus、Vitest、Playwright。

## Global Constraints

- 管理员和主管可查看交班明细；护理员与家属仅查看摘要和各自获授权范围内的待办。
- 后端强制检查角色、照护范围、入住上下文和来源版本；前端隐藏字段不构成授权。
- AI 只生成带原文依据的建议；长期偏好只有在原文明说重复规律且提交人核对后才生效。
- 登记时间由服务器生成，并决定时间线排序、日期分组、筛选和分页；实际发生时间单独展示。
- AI 失败不撤销已保存记录；重试不得重复创建记录、记忆、任务或交班。
- 语音沿用 WAV、最长 60 秒限制；照片沿用 JPEG/PNG/WebP、每张 4 MiB 限制和私有访问。
- 线上迁移先备份并显式执行；不得重置账号或业务数据、提交凭据或真实老人资料。
- 前后端分支分别验证、提交、推送和发布。

---

### Task 1: 后端 schema 9 与旧作业安全迁移

**Files:**
- Modify: backend/app/storage/json_store.py
- Modify: backend/tests/test_elder_workspace.py
- Modify: backend/tests/test_backup.py
- Modify: backend/RELEASE_2026-10-27_RECORD_HANDOVER_TIMELINE.md

**Interfaces:** Add record_analyses collection keyed by record ID and source revision. Schema 8 migration preserves all collections, changes only queued/processing record-analysis jobs to failed with error code requires_inline_reanalysis, and retains completed jobs.

- [x] **Step 1: Add the failing schema migration test**

    def test_schema_eight_migration_preserves_records_and_marks_queued_jobs(tmp_path):
        old = copy.deepcopy(EMPTY_STORE)
        old['schema_version'] = 8
        old['care_records'] = [{'id': 'R1', 'elder_id': 'E1'}]
        old['care_jobs'] = [
            {'id': 'J1', 'record_id': 'R1', 'status': 'queued'},
            {'id': 'J2', 'record_id': 'R1', 'status': 'completed'},
        ]
        store = JsonStore(tmp_path)
        store.path.write_text(json.dumps(old), encoding='utf-8')
        backup = store.migrate()
        data = store.read()
        assert json.loads(backup.read_text(encoding='utf-8')) == old
        assert data['care_records'] == old['care_records']
        assert data['care_jobs'][0]['error_code'] == 'requires_inline_reanalysis'
        assert data['care_jobs'][1]['status'] == 'completed'
        assert data['record_analyses'] == []

- [x] **Step 2: Run the focused test and verify it fails**

Run: pytest backend/tests/test_elder_workspace.py -k schema_eight_migration -q
Expected: FAIL because schema 9 and the new collection do not exist.

- [x] **Step 3: Implement explicit schema 8 to 9 migration**

Add the collection to EMPTY_STORE, retain backup-before-write behavior, update only queued/processing record jobs, and preserve all unrelated user and business data.

- [x] **Step 4: Run migration and backup tests**

Run: pytest backend/tests/test_elder_workspace.py backend/tests/test_backup.py -q
Expected: PASS, with existing schema 1–7 migrations intact.

- [x] **Step 5: Commit the migration deliverable**

Stage the listed backend storage, test, and release files plus the design and plan docs; commit as feat(backend): add inline analysis persistence.

### Task 2: 后端记录即时分析、频率核对与安全重试

**Files:**
- Modify: backend/app/schemas/elder_workspace.py
- Modify: backend/app/api/routes/elder_workspace.py
- Modify: backend/app/services/elder_workspace_service.py
- Modify: backend/app/services/record_service.py
- Modify: backend/app/services/workflow.py
- Modify: backend/app/services/ai_service.py
- Modify: backend/app/services/ai_outputs.py
- Modify: backend/app/main.py
- Modify: backend/app/services/timeline_service.py
- Modify: backend/tests/test_elder_workspace.py
- Modify: backend/tests/test_records.py
- Modify: backend/ELDER_WORKSPACE_API.md

**Interfaces:**
- POST /elders/{elder_id}/record accepts editable text, optional shift, explicit happened_at, and authorized attachment IDs; returns the saved record with inline-analysis status and result.
- POST /elders/{elder_id}/records/{record_id}/analyze retries analysis for the same saved record.
- POST /elders/{elder_id}/records/{record_id}/analysis/{analysis_id}/confirm accepts the submitter's selected or edited task and preference decisions with an idempotency key.
- Provider I/O runs outside JsonStore.mutate. Before commit, recheck staff, elder scope, admission, record revision, and cited source text.

- [x] **Step 1: Add a failing inline-analysis API test**

    def test_record_save_returns_inline_analysis_and_persists_record_once(api, monkeypatch):
        client, store, headers = api
        provider = Organiser()
        monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
        response = client.post('/api/v1/elders/E1/record',
            json={'text': '我每天午休后愿意听戏'},
            headers={**headers(), 'Idempotency-Key': 'inline-record-1'})
        assert response.status_code == 201
        body = response.json()
        assert body['analysis']['status'] == 'ready'
        assert len(store.read()['care_records']) == 1
        assert store.read()['care_jobs'] == []

- [x] **Step 2: Run the focused test and verify it fails**

Run: pytest backend/tests/test_elder_workspace.py -k inline_analysis -q
Expected: FAIL because the current endpoint queues work and returns organising.status=queued.

- [x] **Step 3: Save the record once and persist revision-bound analysis**

Extend RecordSave for shift, actual time, and authorized attachments. Use existing idempotent formal-record saving. Invoke the provider only after the write completes; persist either validated output or a retryable failure. Keep plan scheduling active in the background worker while preventing it from processing legacy record jobs.

- [x] **Step 4: Implement one-step decisions and enforce frequency evidence**

Accept citations only when the quote and source revision match the saved record. Explicit recurring wording such as 每天、每周、经常 may be accepted as a long-term preference after submitter review. Preserve whether the evidence is a single-person self-report or independent observations across distinct dates. Ambiguous frequency and one-time wishes remain recent/current observations. Create new tasks only after the submitter confirms a complete elder, assignee, shift, due time, and completion criteria. Write the confirmer and timestamp to audit data; repeated idempotency keys return the original result.

- [x] **Step 5: Test failure recovery, duplicates, frequency, and revoked access**

    def test_inline_analysis_failure_keeps_record_and_retry_reuses_id(api):
        result = post(api, BASE + '/record', {'text': '今天想休息'}, actor='staff',
                      expected=201, key='inline-failed-record')
        record_id = result['record']['id']
        assert result['analysis']['status'] == 'failed'
        retried = post(api, BASE + f'/records/{record_id}/analyze', None, actor='staff',
                       expected=200, key='inline-analysis-retry')
        assert retried['record_id'] == record_id
        assert len(api[1].read()['care_records']) == 1

Run: pytest backend/tests/test_elder_workspace.py backend/tests/test_records.py backend/tests/test_care_scope.py -q
Expected: PASS, including stale-source, duplicate-confirmation, and revoked-scope cases.

- [x] **Step 6: Commit the inline record API**

Stage the backend schema, routes, services, tests, and ELDER_WORKSPACE_API.md; commit as feat(backend): analyze care records inline.

### Task 3: 后端单页交班接口、待办核对与角色裁剪

**Files:**
- Modify: backend/app/schemas/api.py
- Modify: backend/app/api/routes/handovers.py
- Modify: backend/app/services/handover_service.py
- Modify: backend/app/api/routes/family.py
- Modify: backend/app/services/family_service.py
- Modify: backend/tests/test_handovers.py
- Modify: backend/tests/test_family.py
- Modify: backend/ELDER_WORKSPACE_API.md
- Modify: backend/FAMILY_API.md

**Interfaces:** Keep existing draft/list/receive endpoints compatible. Add editable handover text to analysis, persist reviewed summary and suggestions on the existing handover, carry existing tasks by source ID, and create only complete confirmed tasks. Management receives detailed timestamps and source data; caregiver and family payloads are role-scoped and redacted in the service.

- [x] **Step 1: Add failing tests for a reviewed inline handover**

    def test_handover_analysis_preserves_existing_task_and_creates_only_confirmed_task(api):
        client, store, headers = api
        source, target, record, handover = prepare(api, manual_payload)
        url = f'/api/v1/handovers/{handover["id"]}'
        original_task_ids = {task['id'] for task in store.read()['care_tasks']}
        analyzed = client.post(url + '/ai-summary',
            json={'expected_revision': handover['revision'],
                  'text': '明天下午三点由小王询问是否愿意听戏'},
            headers=headers()).json()
        assert analyzed['ai_summary']['status'] == 'pending_review'
        assert {task['id'] for task in store.read()['care_tasks']} == original_task_ids
        assert {item['source_id'] for item in analyzed['items'] if item['kind'] == 'task'} <= original_task_ids

- [x] **Step 2: Run the focused test and verify it fails**

Run: pytest backend/tests/test_handovers.py -k analysis_preserves_existing_task -q
Expected: FAIL because free-text analysis and confirmed task creation are absent.

- [x] **Step 3: Analyze outside the store lock and commit atomically**

Pass editable text plus current records and open tasks to AI. Recheck handover revision, shift state, access, citations, and task source status after model return. On submit, confirm summary, carry existing task IDs, and create only nonduplicate tasks with explicit person, shift, date, and criteria. Leave incomplete suggestions uncreated.

- [x] **Step 4: Redact detail on all role-specific response paths**

Managers retain full detail. Caregivers see summary and tasks visible under current elder and shift scope. Add a family read path that resolves active family bindings and returns only authorized summary and public follow-ups, stripping staff-only submission, receipt, source, and AI decision fields. Cover a shared handover containing multiple elders.

- [x] **Step 5: Run handover and family permission tests**

Run: pytest backend/tests/test_handovers.py backend/tests/test_family.py backend/tests/test_care_scope.py -q
Expected: PASS; unauthorized users cannot retrieve another elder's summary, items, or audit details.

- [x] **Step 6: Commit the handover API**

Stage the listed backend APIs, services, tests, and API documents; commit as feat(backend): streamline handover analysis and access.

### Task 4: 后端登记时间线排序、筛选与稳定分页

**Files:**
- Modify: backend/app/services/timeline_service.py
- Modify: backend/app/api/routes/elders.py
- Modify: backend/tests/test_care_scope.py
- Modify: backend/tests/test_handovers.py

**Interfaces:** Return server audit creation time as recorded_at and only return happened_at when supplied by the source. Filter, total, sort, and offset use recorded_at; sort newest first with stable event-ID tie-breaking.

- [x] **Step 1: Add a failing backfill-order test**

    def test_timeline_sorts_by_recorded_at_not_happened_at(api):
        client, store, headers = api
        store.mutate(lambda data: data['audit_logs'].extend([
            {'id': 'NEW-REG', 'object_id': 'E1', 'user_id': 'manager',
             'action': 'create_elder', 'created_at': '2099-10-27T09:00:00Z'},
            {'id': 'OLD-REG', 'object_id': 'E1', 'user_id': 'manager',
             'action': 'create_elder', 'created_at': '1999-10-27T09:00:00Z'},
        ]))
        page1 = client.get('/api/v1/elders/E1/timeline',
            params={'event_type': 'other', 'limit': 1, 'offset': 0},
            headers=headers('manager')).json()
        page2 = client.get('/api/v1/elders/E1/timeline',
            params={'event_type': 'other', 'limit': 1, 'offset': 1},
            headers=headers('manager')).json()
        assert page1['events'][0]['id'] == 'NEW-REG'
        assert page2['events'][0]['id'] == 'OLD-REG'

- [x] **Step 2: Run the test and verify the current event-time order fails**

Run: pytest backend/tests/test_care_scope.py -k sorts_by_recorded_at -q
Expected: FAIL because the current service sorts and filters by happened_at.

- [x] **Step 3: Use server registration time for event semantics**

Keep actual occurrence separate, apply filters before pagination, use recorded_at for total/window/order, and preserve current role authorization and shared-handover redaction.

- [x] **Step 4: Run focused tests and commit**

Run: pytest backend/tests/test_care_scope.py backend/tests/test_handovers.py -q
Expected: PASS with no repeated or missing events at page boundaries.

### Task 5: 前端 API 契约及老人记录工作页

**Files:**
- Modify: frontend/packages/api-client/src/types.ts
- Modify: frontend/packages/api-client/src/index.ts
- Modify: frontend/packages/api-client/src/validators.ts
- Modify: frontend/packages/api-client/src/backend-wire.test.ts
- Modify: frontend/packages/shared/src/workflow/ElderQuickRecord.vue
- Modify: frontend/packages/shared/src/workflow/ElderWorkspace.vue
- Modify: frontend/packages/shared/src/workflow/PhotoObservation.vue
- Modify: frontend/packages/shared/src/workflow/elder-workspace.css
- Add: frontend/packages/api-client/src/inline-record.test.ts

**Interfaces:** Parse a response containing saved record, analysis status, and analysis result. Never recreate a record after save when analysis fails. Reuse editable WAV transcription and private photo upload/observation; link only user-reviewed attachment IDs and show elder, admission, shift, recorded time, and actual time before submit.

- [x] **Step 1: Add validator tests for ready and failed envelopes**

    it('preserves a saved record when inline analysis failed', () => {
      const result = parseInlineRecordResponse({
        record: { id: 'R1', elder_id: 'E1', status: 'confirmed', raw_text: '今天想休息' },
        analysis_status: 'failed',
        analysis: null,
      })
      expect(result.record.id).toBe('R1')
      expect(result.analysisStatus).toBe('failed')
    })

- [x] **Step 2: Implement typed API calls and strict response validation**

Use shared request conventions and stable idempotency-key recovery. Reject an elder mismatch, invalid record state, stale analysis revision, or malformed source citation.

- [x] **Step 3: Connect speech, photo, date/shift, and single review card**

Keep speech transcription editable before save. Reuse PhotoObservation and preserve existing upload limits and private access. Show scene, quote, preference frequency classification, and task details together; allow one confirm/edit/reject. On analysis failure, keep the saved record and offer retry for its ID.

- [x] **Step 4: Test save, review, and retry response parsing**

    it('keeps the record ID and retry state when AI analysis failed', () => {
      const result = parseInlineRecordResponse({
        record: { id: 'R1', elder_id: 'E1', status: 'confirmed', raw_text: '今天想休息' },
        analysis_status: 'failed', analysis: null,
      })
      expect(result.record.id).toBe('R1')
      expect(result.analysisStatus).toBe('failed')
    })

Run: pnpm test -- ElderQuickRecord backend-wire
Expected: PASS for response validation and existing speech/photo parsing.

### Task 6: 前端单页交班和护理员导航入口

**Files:**
- Modify: frontend/apps/mobile/src/pages/handover/HandoverPage.vue
- Modify: frontend/apps/mobile/src/components/HandoverEditor.vue
- Modify: frontend/apps/mobile/src/layouts/MobileLayout.vue
- Modify: frontend/apps/mobile/src/router/access.ts
- Modify: frontend/packages/shared/src/workflow/contract.json
- Modify: frontend/packages/shared/src/workflow/model.test.ts
- Modify: frontend/e2e/workflow.mjs

**Interfaces:** Preserve manager and demo workflows. The caregiver page carries active shift and optional elder context, presents source tasks, editable summary, voice input, AI evidence, existing-task continuity, and confirmed new suggestions in one place. Family content uses the scoped API shape.

- [x] **Step 1: Add a failing page test**

In frontend/e2e/workflow.mjs, add a synthetic API response for one open shift, one existing task, an AI summary, and one incomplete task suggestion. Assert that the editor, existing task ID, summary evidence, and one submit action stay on the handover route.

- [x] **Step 2: Implement the single-page interaction**

Refresh current shift data, analyze editable text in place, render citations and suggestions, then submit the reviewed summary and accepted complete tasks once. Keep old task IDs unchanged. Reuse current voice transcription and draft recovery. Add a caregiver nav entry without exposing staff details to family.

- [x] **Step 3: Test failure recovery and no duplicate submit**

In frontend/e2e/workflow.mjs, return HTTP 503 from the synthetic handover-analysis endpoint; assert that the editable handover text remains visible and no submit request is sent.

Run: pnpm test -- useHandoverEditor router && pnpm test:e2e
Expected: PASS with existing route guards, draft recovery, and the one-page browser flow intact.

### Task 7: 前端时间线日期分组与时间标签

**Files:**
- Modify: frontend/packages/shared/src/workflow/elder-activity.ts
- Modify: frontend/packages/shared/src/workflow/elder-timeline.test.ts
- Modify: frontend/packages/shared/src/workflow/ElderWorkspace.vue
- Modify: frontend/packages/shared/src/workflow/ElderActivity.vue
- Modify: frontend/apps/mobile/src/pages/timeline/TimelinePage.vue
- Modify: frontend/apps/admin-web/src/pages/timeline/TimelinePage.vue
- Modify: frontend/packages/api-client/src/types.ts

**Interfaces:** Export groupTimelineEvents(events), accepting items with recordedAt and optional happenedAt, grouping by the Asia/Shanghai calendar date of recordedAt. Render the date groups in newest-first order; show optional happenedAt separately. Retain elder-scoped permissions and pagination.

- [x] **Step 1: Add grouping tests for differing registration and occurrence dates**

    it('groups by registration date and preserves actual occurrence time separately', () => {
      const groups = groupTimelineEvents([
        { id: 'R1', recordedAt: '2026-10-27T09:00:00Z', happenedAt: '2026-10-20T09:00:00Z' },
        { id: 'R2', recordedAt: '2026-10-26T09:00:00Z', happenedAt: null },
      ])
      expect(groups.map(group => group.date)).toEqual(['2026-10-27', '2026-10-26'])
      expect(groups[0].events[0].happenedAt).toContain('2026-10-20')
    })

- [x] **Step 2: Implement shared grouping and load-more rendering**

Show date headings, event type/status, summary, operator, registration time, and optional actual time. Read legacy entered_at as a compatibility fallback; never sort by happened_at.

- [x] **Step 3: Run frontend tests, typecheck, and deploy build**

Run: pnpm test && pnpm typecheck && pnpm build:deploy
Expected: PASS for both mobile and admin builds.

### Task 8: 集成验收、分别发布与部署核验

**Files:**
- Modify: backend/RELEASE_2026-10-27_RECORD_HANDOVER_TIMELINE.md
- Modify: frontend/RELEASE_2026-10-27_RECORD_HANDOVER_TIMELINE.md
- Modify: docs/API.md
- Modify: docs/PRD.md
- Preserve: AGENTS.md

- [x] **Step 1: Run complete backend tests**

Run: pytest -q from backend/.
Expected: All existing and new tests pass; migration verifies the backup and live-data preservation.

- [x] **Step 2: Run frontend checks and synthetic browser flow**

Run: pnpm test && pnpm typecheck && pnpm build:deploy && pnpm test:e2e from frontend/.
Verify text/voice/photo record → AI review → one task/preference decision → handover analysis/submit → elder timeline. Confirm caregiver and family responses contain only permitted fields.

- [x] **Step 3: Review diffs and commit/push branches separately**

Run git diff --check in each checkout. Commit on feat/backend and feat/frontend, then push only those branches; do not merge them.

- [ ] **Step 4: Back up, migrate, deploy, and verify without resetting live data**

Run the documented backup and schema-9 migration on an isolated copy first. Back up the live store, migrate with the explicit command, deploy backend then frontend, and check health, role-scoped responses, saved-record retry, handover, and registration-time ordering on the public site.

- [ ] **Step 5: Record release evidence**

Update both release notes with commits, test counts, schema version, backup location, deployment health, and known limitations. Exclude secrets and real resident data.

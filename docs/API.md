# Core API Contracts

All routes are under `/api/v1`. Staff routes must validate the active account, elder scope, current admission, and source revision on the server. A hidden frontend control is not an authorization check.

## Inline Care Records

- `POST /elders/{elder_id}/record` persists a formal record, then analyzes that saved record in the same request. The response contains `record`, `analysis_status`, and `analysis`. AI failure does not roll back the record.
- Failed analysis optionally includes `analysis_error: {code, message}`. Safe codes distinguish timeout, rate limiting, configuration, invalid output and unavailable service. The message is predefined Chinese text; provider details are never returned. Older clients may ignore this field.
- `POST /elders/{elder_id}/records/{record_id}/analyze` retries analysis for the same record ID and current revision; it must not create a second record.
- `POST /elders/{elder_id}/records/{record_id}/analysis/{analysis_id}/confirm` accepts reviewed preference decisions and complete follow-up tasks. Use `Idempotency-Key`; reject stale revisions and evidence not present in the cited source.
- Human-confirmed personal impressions do not require recurring-frequency wording. The legacy `frequency` field remains for compatibility, not as an adoption threshold. Source revision, access and verbatim evidence checks remain mandatory.
- `GET /elders/{elder_id}/understanding` adds `display_summary` on personal traits and `profile_summary_needed`. Source text remains under `source`/`evidence`, not in the default presentation.
- `POST /elders/{elder_id}/understanding/summarize` prepares and caches concise display summaries for previously confirmed items, then returns the understanding view. It never approves new memories or changes memory content, revision or source. Calls run outside the JSON lock and revalidate source/revision/authorization before saving. Family access remains forbidden.

## Hosted Speech Recognition

- `GET /speech/status` returns the configured `SPEECH_MODEL`; default `Qwen/Qwen3-ASR-1.7B` on SiliconFlow.
- `POST /speech/transcriptions` keeps its raw PCM16 mono 16 kHz WAV request and text response. The returned `model` matches the model sent upstream. Staff authorization, the 60-second limit and separate human confirmation remain unchanged.
- Server-only `SILICONFLOW_API_KEY` and `SPEECH_MODEL` configure the service. The Qwen model is billed by the provider; it is not advertised as the previous free SenseVoice model. No credentials are sent to the frontend or stored in Git.

## Handover Operations

- `POST /handovers/{handover_id}/ai-summary` accepts `{expected_revision, text}` and returns an editable summary, source evidence, and task suggestions.
- `POST /handovers/{handover_id}/submit` accepts the reviewed summary and complete `accepted_tasks`. Existing task source IDs continue unchanged; incomplete suggestions do not create tasks.
- Managers may inspect handover detail. Caregiver responses are limited to authorized elders and handover summaries/tasks. Family endpoints return only reviewed, published family summaries under the current binding; they never expose internal handover detail.

## Timeline

Timeline filters, ordering, and pagination use server-generated `recorded_at`. Optional `happened_at` is shown separately and never determines event ordering.

## Demo Family Selection

- With `DEMO_FAMILY_ALL_ELDERS=true` in demo/development/test, active family accounts explicitly marked `demo_login_enabled=true` receive virtual choices for every elder from `GET /family/me/bindings`. New elders appear on the next list refresh without manual grants.
- These choices include `demo_access: true`; `admission_id` may be null for an elder without a current admission. No admission, consent or authorization record is created by reading the list.
- Virtual choices support existing timeline, published summaries, protected shared photos, insights and feedback endpoints. Published family content may be read across stays for the selected elder; internal records, drafts and unshared photos remain excluded.
- Production/prod and ordinary family accounts retain the existing explicit-grant behavior. Turning off the setting or disabling demo access invalidates virtual choices on the next request.

## 任务与老人上下文

- `POST /tasks` 新建任务；可传 `elder_id`、`shift_id`、`assigned_to`、北京时间 `due_at`、`title` 和完成标准。`GET /tasks?elder_id=...` 按老人筛选，`GET /tasks/{task_id}` 返回中文展示上下文，包括老人、床位、责任人、班次、计划快照、允许动作和历史快照。
- `POST /tasks/{task_id}/transition`、`POST /tasks/{task_id}/complete` 分别处理开始/转交/未执行/完成结果；服务端按当前账号、老人范围、任务状态和幂等键校验。
- 任务时间统一以带时区的 ISO 值传输，前端展示北京时间；`time_confirmation` 返回原文、建议值、最终确认值和调整原因。

## 简化照护安排

- `GET /elders/{elder_id}/arrangement` 返回服务日期、班次、计划事项和当前任务上下文。
- `POST /elders/{elder_id}/arrangement/preview` 只生成预览和 `context_token`，不写入任务。
- `POST /elders/{elder_id}/arrangement/confirm` 使用预览令牌、版本和 `Idempotency-Key` 原子确认；已开始、已完成或人工调整的任务不会被覆盖。

## 记录后台整理与自动任务

- `POST /elders/{elder_id}/record` 先保存正式记录，再返回 `analysis_status`；AI失败不回滚记录。
- `POST /elders/{elder_id}/records/{record_id}/analyze?background=true` 进入持久后台整理；`GET /elders/{elder_id}/records/{record_id}/analysis` 查询状态，失败可按原记录重试。
- 整理结果中的偏好、观察和任务建议必须引用当前记录原文。只有对象、事项、时间和授权条件完整时，才会生成自动任务；不完整建议进入待核实跟进。
- `POST /elders/{elder_id}/records/{record_id}/analysis/{analysis_id}/confirm` 人工确认偏好和任务建议，服务端校验当前版本、证据和幂等键。

## 跟进与质量闭环

- `GET /followups?elder_id=...` 返回当前账号可见的待核实、质量和覆盖跟进事项。
- `POST /elders/{elder_id}/followups/check-today` 执行今日检查；请求可选 `kinds: ["quality"]` 或 `["coverage"]` 只重试失败的单项，使用 `Idempotency-Key`。
- `POST /elders/{elder_id}/organising/{job_id}/resolve-followups` 在人工核对后关闭整理作业中的未完成跟进。质量事件必须经过整改、复查和关闭，AI只能提示不能替代责任判断。

## 个性化理解与过程回放

- `GET /elders/{elder_id}/understanding` 返回有来源、版本、确认状态、适用场景和复核状态的个性化照护记忆。
- `POST /elders/{elder_id}/understanding/{report_id}/{point_id}/decision` 由有权限人员采纳或拒绝候选；更正后生成受影响事项核验清单，不直接改写历史。
- 老人时间线按服务发生时间与登记时间分开返回，过程回放只聚合明确关联的记录、任务、交班和跟进。

## 演示批次

- `demo_batch_id` 在服务端校验。王爷爷重建脚本只用于隔离演示/测试目录；批次变化后旧客户端提交返回 `409 demo_batch_changed`，要求刷新。
- `DEMO_FAMILY_ALL_ELDERS=true` 仅在 demo/development/test 环境允许演示家属切换老人；生产环境仍使用显式授权。

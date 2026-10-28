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

## Safety incident roles and urgent notifications

- Internal staff roles include `nurse` (护士). Nurses use the same current elder assignments, task ownership and shift membership rules as caregivers; they have no management privileges. Supervisors may provision caregiver and nurse accounts. Existing `caregiver_id`/`caregiver_ids` fields also reference nurses for compatibility.
- `POST /incidents` and `POST /incidents/prepare` allow only `caregiver` and `nurse`; both routes and services enforce this. Reports require current elder access and admission, occurrence time, description and immediate action. Evidence is optional; a prior formal record and AI processing are not prerequisites.
- `GET /incidents` and `GET /incidents/{incident_id}` allow management, the reporter and the assigned rectification worker according to existing access rules. Management performs triage and independent review.
- `/notifications` returns `priority: urgent|normal`; active incident notices have urgent priority. Urgent rows sort before ordinary rows before pagination. Incident rows include `incident_status`, `occurred_at`, `rectification_id` and `severity` when available.
- `urgent_total` counts the current actor's authorized active incident notices before unread/pending filters and pagination. Reading or accepting a notice retains its urgency; business transitions update or close the responsible recipient's notice. Legacy pending incidents receive the same projection.

## 2026-10-28 后端兼容契约补齐

以下均为后端能力；本次没有修改前端。客户端需接入新增字段与接口后才能展示对应交互。沿用 schema 9 和 JSON 原子持久化，没有数据库迁移、数据清理或部署动作。

### 完整照护分配查询（新增）

- `GET /elders/work-assignments`：仅管理人员；可选 `elder_id`、`caregiver_id`、`status=active|scheduled|expired|revoked`，`limit=1..200`（默认100）、`offset>=0`。
- 返回 `{items,total,limit,offset,filters,timezone:"Asia/Shanghai"}`；先在同一快照筛选，再计算总数和分页，按创建时间及编号倒序稳定排列。
- 每项保留原始 `status` 与 `revision`，新增 `effective_status`、`elder_name`、`bed_label`、`caregiver_name`、`created_by_name`、`allowed_actions`。未来生效和已过期均由服务器判断，不能只读原始 active 状态。
- `GET /elders/work-assignments/{assignment_id}`：返回上述显示上下文，并增加 `revocation_impact={open_task_ids,open_task_count,retains_task_responsibility,notice}`。这是撤销前的只读预览，不会撤回任务。
- 原 `POST .../{assignment_id}/revoke` 保留，需 `expected_revision`、`reason`，建议同一次提交沿用 `Idempotency-Key`；过期/已撤销/旧版本返回409，无权403、不存在404。撤销不删除历史，也不取消已明确分配的非终结任务责任。
- `GET /elders/worklist/me` 补 `timezone`、老人 `bed_label/admission_id` 和任务展示上下文及 `allowed_actions`；`scope_rule` 为面向工作人员的简短中文。编号继续用于关联，不作为床位或员工名称。

### 列表分页（兼容增强）

`GET /tasks`、`GET /records`、`GET /records/drafts`、`GET /quality/checks` 新增 `envelope=true`，返回统一分页结构。省略该参数仍返回旧数组，旧客户端不用改解析方式。

- tasks 保留 `elder_id/shift_id/assigned_to/status` 筛选，新增 `q`（最长100字，匹配任务标题或老人姓名）。权限和筛选均先于总数/分页，任务按编号稳定排序。
- records 保留 `elder_id/shift_id`；drafts 保留 `elder_id/status`，护理员和护士只能看当前范围且由本人创建的草稿。记录/草稿按服务器登记时间及编号倒序，补录发生时间不改变此排序。
- quality 保留 `elder_id`；列表与详情均补 `source_current`，历史报告来源变化不影响读取，但不能用旧依据确认问题。
- 四者均使用 `limit=1..200`（默认100）、`offset>=0`，total不等于当前页长度。不会为显示名称而扩大老人资料权限。
- `GET /followups` 保留原聚合对象结构，新增 `state=pending|review|closed`、可选 `limit=1..200`、`offset`。省略limit返回旧全量列表。`counts` 是当前老人/权限范围内**应用state前**的三状态分布，`total` 是应用state后的总数；页长度不参与计数。风险事件优先，同类按真实截止时刻与编号排序，无期限排后。
- 跟进中的相同质量问题按问题类型、原文及来源版本取最近报告，不因多次检查复制待办；同一原文上的不同AI问题保留。已读消息不会改变这些业务状态。
- `GET /notifications` 保留分页和 `urgent_total` 定义，补 `filters={unread,pending}` 和 `timezone`。未读与未处理可以重叠，不应相加作为业务待办总数。

### 一次保存与持久后台状态（兼容增强）

`POST /elders/{elder_id}/record` 显式传 `background:true`，会在原子事务中保存正式记录并入队，然后返回201，不等待模型。省略background仍保持旧版同步分析行为，便于现有前端兼容。

保存回执和 `GET /elders/{elder_id}/records/{record_id}/analysis` 保留 `record/analysis_status/analysis/analysis_error`，增加：

```json
{
  "saved": true,
  "job": {
    "job_id": "内部作业编号",
    "record_id": "内部记录编号",
    "source_revision": 1,
    "status": "queued",
    "attempts": 0,
    "error_code": null,
    "retryable": false,
    "result_ref": null
  }
}
```

- status为 `queued|processing|failed|ready|confirmed`；ready是等待人工核对，confirmed是已确认。`job_id` 在历史同步记录中可以为null。`result_ref` 仅对有可用整理结果的记录返回分析编号。
- 记录保存成功与模型完成分别反馈；queued/processing不能显示“整理完成”。失败仍保留原记录，不新建第二条。
- `POST .../analyze?background=true` 只重试该记录当前版本，失败作业重新入队，attempts在领取作业时递增。服务启动恢复中断作业；`BACKGROUND_JOBS_ENABLED=true` 才持续消费，测试环境可显式关闭并手动推进。
- JSON只在读写事务期间持锁；模型在锁外执行。回写重新校验操作者、老人范围、入住、记录版本和批次。重复保存沿用同一 `Idempotency-Key`。

### 照护检查与部分完成（兼容增强）

- `POST /quality/checks` 仍接收 `elder_id/shift_id/handover_id`，新增 `Idempotency-Key` 支持。`include_ai` 变为可省略：省略时使用服务端 `QUALITY_AI_ENABLED`（默认false），显式true/false保留旧语义。要让“一键检查”默认含模型，服务器配置该项为true，前端无需展示模型开关。
- 返回原报告字段及 `checked_at`、`rule_status`、`model_status`、`execution_status=completed|partial`、`has_sources`、`retryable`、`timezone`。`model_status` 为 `not_requested|completed|failed`。
- 无来源时 `has_sources=false`，不调用模型；不能把空来源显示成“确认没有问题”。模型超时、429、无效引用等失败时保留规则报告，execution_status为partial、retryable为true，ai_error使用预定义安全码。范围超过100项或6万字也保留规则结果，需缩小范围再重试模型。
- 相同幂等键和内容重放原回执，不创建第二报告；不同内容复用该键409。无幂等键的同操作者/同范围/同来源/同模型状态，在2秒内共用报告；需要明确重试时使用新的键。并发请求可能重复计算模型，但原子提交不重复写入报告。
- 详情/列表返回报告及问题 `source_current`，问题增加 `related_items[{id,kind}]`。来源变更后 resolve 返回409 `quality_sources_changed_retry_scan`，保留旧报告，提示重新检查。核对建议本身不代表实际服务已完成。
- `POST /elders/{elder_id}/followups/check-today` 使用同一质检策略，模型不占写锁。独立执行quality与coverage，各项 `status=completed|partial|failed`；成功项保留。仅重试失败项时传kinds并使用新幂等键，不另触发重复整套检查。

### 个性化信息分组、适用时间与人工统计（兼容增强）

- 记录分析增加 `preference_groups`；understanding增加 `confirmed_groups/candidate_groups`。保留旧 `preference_suggestions/confirmed/observations`，不破坏旧客户端。
- 每组 `{id,display_summary,items,count,change_kind,similar_group_ids,requires_individual_review}`。精确分组只忽略空白与标点，并保留类别、表达者、适用起止及场景差异；否定、数字、时间不能省略。items保留每个编号和证据。相似度只提供分组提示，绝不作为自动覆盖或自动确认指令。
- 同内容、同证据、同来源版本的已拒绝候选不重复提示；来源版本或证据变化可以再核实。已确认有效且内容未变的个人特性不进入新增队列，新报告证据仍保存在 `unchanged_observations`。此过滤也作用于管理跟进队列。
- 候选增加 `applicability={valid_from,expires_at,needs_time_confirmation,timezone}`。明确“今天/明天/日期”的意愿按记录发生时间在北京时间定位当天范围；“暂时/本次”等没有明确结束日期的意愿需人工补时间，不会默认为无限期偏好。
- `preference_decisions` 的每项及 understanding的decision可选 `expires_at`（带时区日期时间）；没有明确适用时间的临时意愿采纳时未补该字段返回422 `memory_applicability_time_required`。不强迫使用者选择长期/临时分类，但服务器继续保存实际适用时间。
- preference决策与accepted_tasks不允许同一次提交重复suggestion_id，重复422，不创建双份记忆/任务。采纳、拒绝和修改均保存原内容、最终内容、操作者、时间；AI候选仍需人工确认才能生效。

新增主管操作：`POST /elders/{elder_id}/understanding/duplicates/preview` 与 `.../confirm`：

```json
{
  "keep": {"id": "保留的待确认记忆编号", "expected_revision": 1},
  "duplicates": [{"id": "重复候选编号", "expected_revision": 1}],
  "reason": "已核对为同一原文的重复候选"
}
```

- confirm必须有 `Idempotency-Key`，preview不写存储。最多保留1项+重复49项，不可选择重复编号。
- 仅允许内容、类别、场景、表达者、适用时间、原文及版本均完全相同的**待确认**生活偏好/沟通信息。不同证据、已生效记忆、专业照护或旧版本必须单独核实，409。
- 归档项保留为rejected并带duplicate_of；保留项仍是candidate，带duplicate_ids；双方版本和历史更新。没有删除记录、合并独立证据或自动批准。

### 低风险逐项批量（新增）

- `POST /tasks/batch/preview`：主管预览；`POST /tasks/batch/transfer`：主管确认转交，必须 `Idempotency-Key`。
- 请求 `{action:"transfer",items:[{id,expected_revision,assigned_to}],note}`。最多50项，编号重复422。转交沿用单项校验：有效员工、开放班次及班次成员、当前版本/状态、必填备注等。条件核验、照护计划或照护建议来源任务返回 `batch_task_requires_individual_review`，需进入详情单独办理。
- `POST /notifications/batch/read`：当前工作人员批量标已读，必须 `Idempotency-Key`。请求 `{action:"read",items:[{id,expected_revision}]}`；只读本人仍有权访问的通知，不能替他人操作，也不接单或关闭业务。
- 返回 `{action,preview,items:[{id,success,result? ,error_code?,status_code?,message?}],succeeded,failed}`。逐项副本隔离，失败项不产生修改；成功项及回执在一个JSON事务中提交。预览对成功/失败作相同校验但不写入。已成功项重试只重放，不重复变更版本。
- 422为请求格式/动作不匹配或缺幂等键，403为角色不符；批内单项失败在200的items中明确列出。不得把HTTP200整体显示成“全部成功”。本次不提供批量完成、批量质检确认或批量关闭事件。

### 运行评估与中文错误（兼容增强）

- `/ai-governance/operations` 增 `personal_impressions={reviewed,adopted,rejected,edited}`，仅统计此次开始实际记录了human_decision的决定，不回填推测旧历史；是当前候选最终决定统计，不是准确率或完整操作次数。
- 运行记录补安全 `error_code`、有版本来源输入的 `source_versions`，覆盖personal_profile；不记录原文、提示词、凭证或供应商异常详情。没有带版本来源的原始文本输入，其source_versions可为空；源版本另在业务分析记录中保存。
- 独立评测保留人工gold、development/holdout、版本共同样本、precision/recall/F1及错误引用统计；feature新增personal_profile。不能用采纳率替代准确率。
- HTTP错误及业务错误保留兼容detail，补稳定error_code、中文safe_message、retryable；401等原响应头保留。前端显示safe_message，把技术码留给排查。输入验证不回显正文或密钥。
- 云端模型与mock分别记录；本轮标准回归跳过真实云调用，当前工作副本未配置密钥，不能据此宣称真实模型准确率或已完成真实语音/照片验收。

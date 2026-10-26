# 后端接口约定（0.4.2）

2026-10-27 后端接口补充（0.6.0 / schema 9）：老人即时记录、分析与确认的契约见 [ELDER_WORKSPACE_API.md](ELDER_WORKSPACE_API.md)；单页交班的输入、建议和安全重试见下方交班说明；家属摘要范围见 [FAMILY_API.md](FAMILY_API.md)。老人时间线新增 `recorded_at`，并以登记时间执行日期筛选和分页排序；`happened_at` 仅代表来源明确提供的实际发生时间。新增分析接口不取代旧 `/records/manual`、草稿确认和交班路径。

2026-10-24：记录整理增加可核对的时间、人员安排建议，正式确认时与任务同存；记录也进入该老人的长期印象证据，任务安排不作为已发生服务证据。印象须单独整理、人工确认；更正来源后旧结论需重新核对。请求路径与原有字段兼容，无存储迁移。语义和边界、前端接入及验收见 [RECORD_TASKS_2026-10-24.md](RECORD_TASKS_2026-10-24.md)。

0.4.2 修复重试一致性，不改变现有请求/响应结构或 JSON schema 4。`POST /records/{draft_id}/confirm` 对首次确认保存有效内容指纹；相同内容重试仍返回已有记录与当前任务，不重复创建。不同内容或旧版已确认但无指纹的草稿返回 409 `draft_already_confirmed_refresh_record`，客户端应查询正式记录并使用更正接口，不能显示“修改已保存”。任务转交相同账号/键/内容重试可在责任人已变化后回放成功结果；当前账号权限仍须有效，不同内容返回冲突。覆盖核对以最新审核决定去重，支持另一主管重新打开后再次提交明确决定。详见 [RELEASE_2026-10-21.md](RELEASE_2026-10-21.md)。下列各版本说明保留为历史记录。

统一前缀 `/api/v1`。Swagger：`/docs`。全部使用 snake_case JSON；时间包含时区，例如 `2026-10-18T20:00:00+08:00` 或 UTC `Z`。业务接口要求 `Authorization: Bearer <access_token>`；健康、登录和独立语音测试页公开。全部`/api/`响应禁止缓存。

0.4.0补齐家属账号/授权/审核简报/反馈、不良事件/整改独立复查、统计与JSON案例导出，新增24个操作，当前OpenAPI共109个操作。详见[FAMILY_API.md](FAMILY_API.md)、[INCIDENT_API.md](INCIDENT_API.md)、[REPORTS_API.md](REPORTS_API.md)。schema仍为4，已有v4不增集合；旧v1/v2/v3仍须显式迁移。正式记录新增可选admission_id，由创建事务写入当前入住归属，旧未知记录不伪造回填，不作为家属简报或事件新证据。新增接口为前端确认稿，本地验证不代表线上接入。

本文件是后端新增接口交接稿，供前端协作者确认接入。现有八个接口保留原路径和主要返回结构；页面是否接入以实际联调为准。

0.3.0新增 `/memories` 个性化照护记忆接口，详细请求、状态机、权限与场景查询见 [MEMORY_API.md](MEMORY_API.md)。原有接口保留；记录更正新增同步动作：关联的非终态记忆转待复核，旧证据保留。健康接口schema_version由2升级为3，更新服务必须先显式迁移存储文件。

0.3.1新增 `POST /records/context-extract` 和 `POST /memories/from-draft`；详细上下文范围、候选确认顺序、版本复核和失败处理见 [ASSISTANT_API.md](ASSISTANT_API.md)。AIDraft增加generation_kind/memory_candidates/context_notes/context_snapshot，旧接口与旧数据使用默认空值。JSON schema仍为3，无新增集合。

0.3.2新增任务采用记忆的明确关联、撤回及当前核验接口，详见 [TASK_MEMORY_API.md](TASK_MEMORY_API.md)。任务返回新增memory_references历史快照；动态有效性使用专用GET核验。AI引用不会自动成为任务采用证据，普通task_candidates不能直接提供memory_references。JSON schema保持3。

0.3.3新增 `/change-reviews` 变更影响核验队列：自动检测记忆写入变化、手动扫描到期、指派、负责人提交、另一人复查关闭/退回；定位任务和交班快照，逐项校验当前处理状态、正式记录证据和上下文指纹。接口、请求示例、权限与前端接入顺序见 [CHANGE_REVIEW_API.md](CHANGE_REVIEW_API.md)。当前JSON schema为4，v1/v2/v3更新前均须停服后显式迁移；已有编号及历史保留。无自动定时扫描或消息推送。

0.3.4为复查修复，请求和返回字段不变、JSON schema仍为4：任务写入补充班次开放和成员检查（关闭409 `shift_closed`，非成员403 `not_a_shift_member`）；时间线逐事件过滤无交班访问权的内容；普通AI提取/交班摘要/质检在保存前复查账号和原角色，权限变化403 `staff_permissions_changed`，不保存结果。详见 [REVIEW.md](REVIEW.md)。

0.3.5新增条件待办核验：`GET /tasks/{id}/condition`、`POST /tasks/{id}/condition/configure`、`claim`、`check`。主管明确标准及核验人，指定人引用当前记录人工判断；满足须有效期。原任务 `start/complete` 会拦截未配置/未满足/失效条件；跨班清空当前核验责任及结论，保留历史，再明确认领核验。AI上下文/交班/质检同步检查条件状态变化。普通任务新增可选condition_verification快照，实时有效性须查专用GET；JSON schema仍为4。请求、权限、状态和联调步骤见 [TASK_CONDITION_API.md](TASK_CONDITION_API.md)。

0.3.6补齐老人/员工/床位与入住流程，共13个新增接口操作。新增老人初态pending及revision/current_admission_id/care_state_version；原读取路径保留，原员工lookup仍只返回三个字段。入住/换床/外出/返院/离院同事务核对占用，旧在院资料需明确补登记；员工启停/改角色/重置密码使旧令牌失效，停用前须交接责任。待入住/已离院不新建照护记录或首次执行任务，AI草稿保存/确认检查照护状态变化。JSON schema仍为4，已有v4无需迁移。详见 [FACILITY_API.md](FACILITY_API.md)，供双方确认接入；尚未前端联调或部署。

## 通用约定

0.3.7新增12个评估/照护计划接口操作，详见 [PLANNING_API.md](PLANNING_API.md)：人工Barthel基础计分草稿、主管确认及机构档位依据、复评替代版本、计划审批/替代/停用、按日期实际班次去重生成任务、明确补发及当前依据核对。评估和计划失效会拦截旧计划任务开始/完成，交班/上下文AI/质检同步核对；AI不自动评估、定级或执行。schema仍为4。另补齐记录更正/放弃草稿在事务内的当前账号校验，详见REVIEW.md新增复查记录。新接口为供前端确认的交接稿，未部署。

- 列表直接返回数组，支持 `limit`（默认100，最大200）和 `offset`（默认0）；timeline 默认200、最大500。老人列表沿用旧接口，不分页。
- 角色：管理人员为 `admin/supervisor`；工作人员另含 `caregiver`；`family`仅访问`/family/me/...`，不能访问内部`/family/cases`、原始记录、质检、事件或内部案例导出。
- 401：未登录、令牌过期、账号停用或角色变更。403：角色、作者或班次权限不足。404：资源不存在。409：版本或状态冲突。422：输入不合要求。503：AI不可用或输出未通过校验。
- 业务错误返回 `{"detail":"错误码"}`；参数校验返回 FastAPI 的 detail 数组。前端需同时处理。
- `expected_revision` 是读取对象时的 revision。409 时重新获取并核对，不能盲目重试覆盖。
- 人工记录、更正、任务完成/流转、创建班次支持 `Idempotency-Key` 请求头（1–128字符）。一次操作使用同一个随机key重试；同key不同正文返回409。AI确认本身防重复创建，但重复确认不会修改已确认记录，应走更正接口。
- 本版不硬删除正式记录、任务、审计或交接条目。

## 登录和老人读取

| 方法 | 路径 | 权限 / 说明 |
|---|---|---|
| GET | `/health` | 公开，status/environment/schema_version |
| POST | `/auth/login` | username/password → access_token、token_type、user_id、role、display_name |
| GET | `/elders` | 工作人员，老人数组 |
| GET | `/elders/{elder_id}` | 工作人员，老人详情 |
| GET | `/staff` | 管理人员；有效员工id/display_name/role，用于班次成员和任务负责人选择；支持分页，不返回密码散列 |

老人ID从接口获取，不用床号、姓名或前端静态示例ID代替。老人/员工增改、床位及入住操作见 [FACILITY_API.md](FACILITY_API.md)。新建老人为pending，正式入住后才参与照护；前端需支持该新状态。

## 护理记录

| 方法 | 路径 | 正文 / 参数 / 说明 |
|---|---|---|
| GET | `/records` | elder_id、shift_id、limit、offset；正式记录 |
| GET | `/records/drafts` | elder_id、status、limit、offset；护理员只查本人草稿 |
| GET | `/records/drafts/{draft_id}` | 作者或管理人员 |
| POST | `/records/extract` | elder_id、text、可选shift_id；生成pending_review草稿，不创建任务 |
| POST | `/records/{draft_id}/confirm` | observations、task_candidates 均可省略沿用草稿；人工确认后返回record和tasks |
| POST | `/records/drafts/{draft_id}/reject` | reason；保留原文，拒绝后不可再确认 |
| POST | `/records/manual` | 下方示例；无需AI，返回record和tasks，201 |
| GET | `/records/{record_id}` | 正式记录含revision、corrections |
| GET | `/records/{record_id}/history` | 更正历史数组 |
| POST | `/records/{record_id}/corrections` | observations、reason、expected_revision；作者或管理人员 |

人工记录示例：

```json
{
  "elder_id": "从接口获取",
  "shift_id": null,
  "raw_text": "演示：午餐进食一半，请联系家属反馈。",
  "observations": ["午餐进食一半"],
  "happened_at": "2026-10-18T12:10:00+08:00",
  "task_candidates": [
    {"title": "联系家属反馈", "due_at": null, "assigned_to": null, "condition": null, "due_text": null}
  ]
}
```

`observations`不传则沿用raw_text；传入不能为空。候选任务至多50项，title必填；due_at必须带时区，assigned_to必须是有效员工；关联班次时必须属于该班。护理员只能给本人指定任务或留空，管理人员可安排班内员工。

草稿保留 `raw_text/observations/task_candidates/evidence/warnings/provider/created_by`。真实AI输出严格校验结构、原文片段和候选任务证据；不会自行编造负责人ID或将“晚上”等词猜成精确截止时间。确认时人工可编辑观察与候选任务。

更正不会改写raw_text，会保存前后观察、原因、操作者和时间，revision递增；此前已创建任务不会被更正接口静默重写。关闭班次不能新增记录或确认草稿，但允许带留痕更正。

## 任务

| 方法 | 路径 | 权限 / 正文 |
|---|---|---|
| GET | `/tasks` | 工作人员；elder_id、shift_id、assigned_to、status、分页 |
| GET | `/tasks/{task_id}` | 工作人员 |
| PATCH | `/tasks/{task_id}` | 管理人员；expected_revision，可选assigned_to、due_at；显式null清空 |
| POST | `/tasks/{task_id}/complete` | 本人任务、未分配任务或管理人员；result |
| POST | `/tasks/{task_id}/transition` | action、expected_revision；另见下表 |

| action | 状态变化 / 必填 |
|---|---|
| start | pending/overdue → in_progress |
| not_done | 活跃任务 → not_done；reason_code、note |
| reopen | not_done → pending；note；完成/取消任务不能重开 |
| transfer | 原任务换负责人；assigned_to、note；不新建任务 |
| cancel | → cancelled；仅管理人员；note |

`reason_code`固定为 `elder_refused/out/unwell/staff_shortage/equipment/family_request/other`。流转保留前后状态与理由。已完成、已取消任务不可覆写；同结果再次完成返回原任务，不同结果返回409。

`overdue`按读取时的due_at动态推导，不批量修改存储；缺少时间不猜测逾期。条件放在condition字段，由工作人员核对是否满足，不自动触发临床行动。

## 班次和交接班

| 方法 | 路径 | 正文 / 说明 |
|---|---|---|
| POST | `/shifts` | 管理人员；name、start_at、end_at、caregiver_ids；201 |
| GET | `/shifts` | 工作人员；分页 |
| GET | `/shifts/{shift_id}` | 工作人员 |
| POST | `/handovers` | source_shift_id、target_shift_id；交班成员或管理人员；201 |
| GET | `/handovers` | 本人参与的交接或管理人员；shift_id、分页 |
| GET | `/handovers/{handover_id}` | 返回交接对象与items数组 |
| POST | `/handovers/{handover_id}/refresh` | 仅草稿；刷新明细，清空旧AI摘要，revision递增 |
| POST | `/handovers/{handover_id}/ai-summary` | expected_revision、可编辑text（可空）；锁外生成带原文依据的摘要和 `handover_suggestions`，不创建任务，revision递增 |
| POST | `/handovers/{handover_id}/submit` | expected_revision、summary（可选）、approve_ai_summary（默认false）、accepted_tasks（默认空）；仅完整且经确认的新建议会生成任务 |
| POST | `/handovers/{handover_id}/items/{item_id}/receive` | 接班成员或管理人员；status为received/clarifying，note、assigned_to可选 |
| POST | `/handovers/{handover_id}/items/{item_id}/clarify` | 交班成员或管理人员；note，答复接班疑问 |

班次使用明确的实例ID和起止时间，允许跨午夜，最长24小时。相同员工时间重叠返回409。目标班次须晚于源班次开始。相同源/目标班次重复生成返回同一交班单。

交班单状态：`draft → submitted → received`。items状态：`pending / clarifying / received`，每条保留kind、source_id、source_revision、elder_id、detail、condition及澄清记录。

提交前后端检查正式记录及未完成任务的版本集合；变化返回409 `handover_needs_refresh`。人工提交会关闭源班次，禁止继续往旧班新增记录。目标班逐项接收，澄清需附问题；交班方答复后可确认，也可附解决说明后确认。

任务接班沿用原task_id和continuity_key，换到目标班次及负责人，保留审计中的原状态、结果与未执行原因，不生成重复任务。未指定负责人时优先接收者本人（须属于目标班）；管理人员代接需指定目标班成员。已完成/取消的任务不重新激活。

AI摘要包含 `points[{text,citations[{source_id,quote}]}]`、provider、status、warnings、uncovered_task_ids。引用ID和原文逐字校验；未覆盖任务有显式提醒，明细保留全部任务。生成不会关闭班次或提交交班。提交时显式 `approve_ai_summary:true` 才确认该摘要；否则使用人工summary，AI摘要标为not_used。生成期间资料更新会拒绝保存。引用校验不等于语义准确，仍需人工核对。

可编辑交班文本中的任务线索作为 `handover_suggestions[{id,title,evidence_text,condition,due_text}]` 返回；仅逐字原文依据可确认。`accepted_tasks` 每项须包含 suggestion_id、elder_id、title、目标班次shift_id、唯一负责人assigned_to、带时区的due_at和completion_criteria。目标班次必须开放且包含负责人，老人必须属于交班来源，截止时间须在目标班次内，重复任务不再创建。原有未完成任务继续使用原task_id。护理员响应只含当前老人照护范围内的明细；管理人员保留完整明细。家属只通过 `/family/me/bindings/{id}/handovers` 读取已发布公开简报，不读取内部交班内容。

## 质检和证据时间线

| 方法 | 路径 | 权限 / 正文 |
|---|---|---|
| POST | `/quality/checks` | 管理人员；elder_id/shift_id/handover_id可选，include_ai默认false；201 |
| GET | `/quality/checks` | 管理人员；elder_id、分页 |
| GET | `/quality/checks/{report_id}` | 管理人员 |
| POST | `/quality/checks/{report_id}/issues/{issue_id}/resolve` | 管理人员；status=acknowledged/not_applicable，note必填 |
| GET | `/items/{item_id}/timeline` | 工作人员；分页；支持老人、记录、本人草稿、任务、本人交班及管理人员质检报告 |

规则检查覆盖未分配负责人、截止时间待确认/格式错误、逾期、未确认草稿、交班明细缺失/过期和AI摘要未引用待办。`include_ai:true`另请求DeepSeek查文本矛盾等；每项带可校验的source_id和quote。真实AI失败返回503，未保存伪成功报告；可改为规则扫描。

报告为历史快照，`historical_snapshot:true`，保留来源、扫描时刻、provider、warnings、issues和人工处理。issue状态从pending_review到acknowledged或not_applicable，后一种也要求理由。处理质检建议不会直接改记录、任务或事故等级；处理后如需验证改进，应重新扫描。

timeline返回action、label、actor/actor_id、source_id、recorded_at、happened_at、detail；`recorded_at`是服务端审计登记时间，决定过滤、分页、日期分组和最新优先顺序；`happened_at`只在来源明确提供实际发生时间时返回。旧数据没有审计的步骤不虚构补齐。护理员看不到他人草稿或管理端质检审阅记录。

AI摘要/质检输入最多100条、累计60000字，超限需按老人或班次缩小范围。演示存储不适合大量历史全量扫描。

## 前端接入顺序与边界

1. 真实登录后保存token，401退出登录；从elders和shifts接口选择真实ID，管理端通过staff接口选择有效员工。
2. 记录：extract → 内联核对 → confirm；失败保留文本并允许manual；草稿列表支持找回/放弃。
3. 任务：服务端GET刷新；编辑与流转携带revision，不再只改localStorage。
4. 交班：先创建实际班次，调用复数`/handovers`接口；生成/刷新后读取新revision，再摘要/提交/接收。
5. 管理端质检：扫描 → 点引用看原文/时间线 → 人工处理；家属端不能调用工作人员接口。

前端camelCase视图字段应在API适配层与snake_case转换。此前页面中预留的单数`/handover/...`不是本后端接口。当前前端大部分业务仍为localStorage演示，新增接口不代表页面已自动联通。

云端语音识别接口见下节，DeepSeek现有接口仍接收校对后的文字。评估与按周期显式生成计划任务见PLANNING_API.md；老人/员工增改和入住见FACILITY_API.md。家属工单/授权、其他评估量表、定时自动生成及经营统计仍待后续阶段。

## 云端语音识别（SiliconFlow）

不部署本地语音模型，由硅基流动 `FunAudioLLM/SenseVoiceSmall` 识别；Key只放服务器环境变量 `SILICONFLOW_API_KEY`，前端不得持有。官方价目表目前标为免费，不承诺永久价格、无限频率或任何账号必有权限。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/speech/status` | 工作人员；configured仅表示已配置Key，不等于厂商鉴权已通过 |
| POST | `/speech/transcriptions` | 工作人员；原始WAV二进制正文，Content-Type:audio/wav；不是multipart |
| GET | `/speech/demo` | 独立手机录音测试页；调用识别前仍须工作人员登录 |

音频限定PCM16、单声道、16000Hz的WAV，最长60秒、最大3MiB；客户端负责转成此格式，服务器不安装ffmpeg或语音模型。测试页实现浏览器麦克风采集、重采样和WAV编码，可供前端协作者参考。当前是录完识别，不是流式识别。

返回示例：

```json
{
  "text": "老人今天没有外出，午餐吃了一半。",
  "provider": "siliconflow",
  "model": "FunAudioLLM/SenseVoiceSmall",
  "duration_seconds": 6.2,
  "requires_confirmation": true,
  "saved": false,
  "warnings": ["请核对人名、数值、否定和条件；转写尚未保存为护理记录。"]
}
```

接口只返回文字，不写store.json，不保存录音、不自动生成草稿、不创建正式记录或任务。录音发送至厂商，其数据留存以厂商政策为准，本项目不宣称能控制厂商留存。

前端示例：

```javascript
// wavBlob由客户端生成，须符合上述WAV格式；勿直接上传MediaRecorder的webm。
const response = await fetch('/api/v1/speech/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'audio/wav' },
  body: wavBlob
});
if (!response.ok) throw new Error('识别失败，请保留原文并允许手工输入');
const result = await response.json();
// 将result.text回填原文输入框，由护理员编辑核对；不要自动调用confirm。
```

链路：录音 → 转写 → 护理员校对 → `/records/extract` → 再次核对草稿 → `/records/{draft_id}/confirm`。也可将校对文本直接提交`/records/manual`。识别成功不等于记录已保存或任务已执行。

错误：413录音过大；415格式不支持；422空音频/截断/超过60秒/未识别到文字/厂商拒绝音频；429本机或厂商限流；503未配置、密钥/权限无效、厂商不可用或错误响应；504厂商超时；408上传超时。不返回厂商错误正文或凭证，不自动重试，不切换收费模型。失败保留已有文字并提供手工输入。

单进程同时最多2段、每用户同时1段、每用户每分钟6次；上传读取限20秒，厂商响应默认45秒。配套Nginx仅对该上传路径允许3MiB正文、关闭请求体磁盘缓冲；其他接口保持64KiB限制。部署须同步Nginx，否则原64KiB限制会阻止上传。

测试页是backend内独立入口，不代表前端分支快速记录页的语音按钮已经接入。

## 本轮新增的核验接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/tasks` | 独立创建人工或正式记录来源任务；使用 `Idempotency-Key` 可安全重试 |
| POST | `/memories/{memory_id}/refusals` | 登记一次拒绝；同一记录去重，重复拒绝只生成复核提示 |
| GET | `/records/context` | 服务端根据老人、场景、班次和护理员权限生成上下文来源清单 |
| PATCH | `/records/drafts/{draft_id}` | 人工编辑待核对草稿；使用 `expected_revision`，记录前后差异和理由 |
| POST | `/records/{record_id}/corrections/preview` | 只读列出明确引用该记录的记忆、任务、交班项目和家属摘要，返回预览指纹 |
| POST | `/records/{record_id}/corrections/apply` | 使用预览指纹应用更正；依赖变化时要求重新预览 |
| GET | `/records/{record_id}/impact-reviews` | 查看记录更正影响核验清单 |
| POST | `/records/{record_id}/corrections/{correction_id}/review` | 管理人员提交影响核验结果，不自动完成任务或重写历史 |

业务错误同时返回 `detail`、`error_code`、`safe_message` 和 `retryable`；供应商错误正文、密码和护理原文不会写入错误响应。AI失败保留 `draft_id`，原文进入失败草稿并可改用人工录入。
# 老人印象

老人印象从单一老人的已确认／已更正照护记录中，整理兴趣喜好、生活习惯、活动规律、沟通方式和照护关注。AI输出必须带记录编号和逐字引用，来源以当前有效的`observations`为准。系统保留批次覆盖数、发生／录入时间、来源指纹和模型来源。输入有上限（240条、16万字），超限完整拒绝；分批整理并合并，不静默丢弃早期记录。模型或引用校验失败时返回503且不保存。

```text
GET  /api/v1/elders/{elder_id}/impressions
POST /api/v1/elders/{elder_id}/impressions/generate
GET  /api/v1/elders/{elder_id}/impressions/{report_id}
POST /api/v1/elders/{elder_id}/impressions/{report_id}/points/{point_id}/review
```

以上均仅限已登录的管理员、主管或护理员；家属不可访问。整理结果为候选，绝不自动改写照护计划、正式记忆或任务。管理员和主管可填写理由逐条确认或拒绝；护理员可查看、生成，不能确认。AI候选即使经人工核对也只表示已核对，不等同专业要求。

若来源记录新增或更正，旧版标为需刷新并阻止新确认。历史版本只读；30天到建议复核时须先重整当前版本；到期提示不自动令既有偏好失效。三处日期及原文证据只是展示下限，不代表统计频率或科学结论。

用`backend/scripts/seed_impression_demo.py --apply`可在`APP_ENV=demo`向唯一现有的张阿姨追加84条、约12周的虚构记录。脚本先备份现存store，使用正常人工记录服务、模拟发生时间和真实录入时间，保留用户/其他业务数据并以幂等键避免重复。绝不用于真实环境。

## 将已核对印象加入照护记忆（2026-10-24）

`POST /api/v1/elders/{elder_id}/impressions/{report_id}/points/{point_id}/activate-memory`

仅管理员或主管可提交。请求为 `MemoryContent` 的全部适用字段，并增加 `expected_revision`（印象条目版本）和 `reason`（本次人工确认原因）。示例只用于解释字段，不可替代真实原文核对：

```json
{
  "expected_revision": 2,
  "reason": "已与本人核实，当前仍适用，每次服务前仍询问当次意愿",
  "content": "午后活动前询问是否愿意听吕剧",
  "category": "stable_preference",
  "scenes": ["activity"],
  "attributed_to": "elder",
  "source_record_id": "使用所选引用的实际记录编号",
  "source_revision": 1,
  "source_field": "observations",
  "source_quote": "使用该印象条目中的逐字引用"
}
```

可携带 `Idempotency-Key`；返回 `MemoryResponse`。仅 `trend` 且不属于 `attention` 的已核对条目可加入，仅支持 `stable_preference` 或 `communication`，还须通过记忆来源校验。该操作将建立并明确人工确认一条记忆；不是模型自动确认，不调用模型，不创建任务或计划。

同一报告同一条目只允许建立一条关联记忆；完全相同的重复请求返回已有结果，不同内容的重复请求报409。条目未核对、临时意愿或证据不匹配报422；旧版、过期或来源已变报409；无权角色报403。条目返回可选 `care_memory: {id, status, effective}`，供页面刷新后显示关联状态。

新建时绑定该条目全部引用记录的版本。任何被引用来源更正、撤回或条目被撤回核对，记忆均不再进入 `GET /memories/context` 或上下文助手。单纯新增一条无直接引用关系的记录会要求重新整理印象，不直接作废既有已确认记忆。

# 最终改进清单：后端对接说明

依据：《护老智交_改进分工清单_最终版_2026-10-25-v2》。本次只调整 `backend/`；页面合并、侧栏、手机布局和液态玻璃由前端实现。原有接口保留，新接口前缀均为 `/api/v1`。

## 1. 通用约定

- 使用现有登录令牌：`Authorization: Bearer <token>`。前端隐藏按钮不能代替服务端授权。
- 修改接口如支持幂等，传 `Idempotency-Key`，相同动作重试保留同一键；用户更改内容后使用新键。相同键对应不同内容返回冲突，不能当成成功。
- 带版本的操作传服务端最后返回的 `expected_revision`；409 时刷新后核对，不自行把版本加一重试。
- 时间必须包含时区；时间线按左闭右开筛选。看板 `start/end` 为北京时间日期，`end` 当日不包含。
- 业务错误返回 `error_code/detail` 与中文 `safe_message`，界面优先展示中文。枚举和内部编号用于通信，不能直接作为页面标题。
- 返回的 AI 内容是待人工核对草稿；“模型已返回”不能替代引用校验、专业审核或正式确认。

## 2. 当前照护范围与老人工作台

### 查询

`GET /elders/worklist/me` 返回 `items`：每项包含 `elder`、`scope_reasons`、`open_tasks`、`pending_count`、`overdue_count`、`assignment_ids`。

护理员范围来自有效的明确分配、临时支援、本人非终态负责任务，或本人当前开放班次的待办。过去的记录和已结束班次不会产生永久权限。已完成的本人任务可查回执，但不能因此打开老人档案、当前记忆和条件核验详情。

管理人员可查看机构内工作台；护理员的老人、记录、任务、评估、计划列表在分页前按范围过滤，相关详情和写入也校验。

### 安排与撤销

主管或管理员：

- `POST /elders/work-assignments`：`elder_id, caregiver_id, kind, start_at, end_at, reason`。
- `kind` 为 `explicit_assignment`（明确分配）或 `temporary_support`（临时支援）。
- `POST /elders/work-assignments/{assignment_id}/revoke`：`expected_revision, reason`。

两接口支持幂等。到期或撤销后重新计算范围。旧页面若尚未安排照护范围，应提示主管分配；不能通过绕过403恢复全员可见。

## 3. 老人时间线

`GET /elders/{elder_id}/timeline`

参数：重复传入 `event_type`，可选 `record/task/handover/memory/incident/family/other`；`start/end` 为带时区时间；`limit` 为1～500、默认200；`offset` 从0开始。

返回 `events,total,limit,offset,has_more,filters,notice`。事件含中文 `label`、类别、操作者、发生时间、录入时间、来源编号及有权限读取的依据。共享交班仅返回导航元数据，避免整份摘要将其他老人资料带入当前老人时间线。

时间线用于追溯系统登记情况，不能凭一条完成记录证明现实中的服务一定发生。

## 4. 统一记录、任务、记忆与接续

沿用已有文档：`API.md`、`ASSISTANT_API.md`、`RECORD_TASKS_2026-10-24.md`、`MEMORY_API.md`、`TASK_MEMORY_API.md`、`TASK_CONDITION_API.md`、`CHANGE_REVIEW_API.md`。

- 页面统一“记一条”，底层仍可调用文字/语音整理、上下文整理和手工保存接口。
- `/records/{draft_id}/confirm` 在同一个JSON事务中保存正式记录及人工确认的任务候选；重复确认不重复建任务。
- 正式记录是老人印象的数据来源；不为每条记录额外伪造一个印象，也不在保存时等待重新生成整份多日印象。
- 明确对象、时限、负责人等信息后才能确认任务；缺失信息保持候选。护理员不能替其他人任意派任务。
- 临时意愿不自动升级为长期偏好；连续拒绝只触发复核。到期复核与信息失效分别处理。
- 班次接收、澄清、条件核验、变更预览、结果复查沿用原有受控状态转换。
- 模型超时或失败可保留原文并走手工路径；模型调用后保存前再次检查账号、老人状态与工作范围。

## 5. 照护安全与事件上报

- `POST /incidents`：人工立即上报，字段 `elder_id,admission_id,occurred_at,description,immediate_action`，`evidence` 可为空，支持幂等。无需先有AI草稿或正式记录。
- `POST /incidents/prepare`：可选辅助整理，字段 `elder_id,description`，可选 `occurred_at,immediate_action`；返回 `facts_draft,missing,provider,elapsed_ms,status,warning`。只整理有引文的事实，不保存事件、不自动定级定责。失败返回503并提示直接人工上报。
- 原有主管分级、分配、整改提交、独立复查、退回、关闭及重开见 `INCIDENT_API.md`。主管分级与整改结果仍要求补充正式记录证据。
- `restraint/injury` 新增至人工分类枚举；展示为中文“约束相关”“伤害相关”。分类不是AI判定。

## 6. 待我处理通知

- `GET /notifications?unread=false&pending=false&limit=100&offset=0`
- 返回 `items,total,offset,limit,as_of,definition`；通知含 `object_type/object_id/elder_id/title/stage/status/read_at/accepted_at/returned/revision`。
- `POST /notifications/{notification_id}/actions`：`expected_revision,action`，其中 `action=read|accept`，支持幂等。
- `read` 只标记已读；`accept` 只标记通知接单，**不改变任务、交班或整改的业务状态**。
- 退回、关闭必须操作关联业务，业务事务会同步关闭旧通知或发送新责任通知。不能设计“点击铃铛处理完成就完成护理任务”。
- 通知与业务审计同事务保存；同一事件不重复发送。迁移前遗留待办首次查询会补入通知；记忆到期提醒也会持久化去重。
- 用户只能操作发给自己且仍有权访问对象的通知；家属不开放内部通知接口。

## 7. 私有照片附件

### 上传与读取

`POST /attachments?elder_id=<id>&occurred_at=<aware-time>&caption=<text>`

请求体为图片二进制，**不是JSON也不是multipart**；请求头 `Content-Type: image/jpeg` 或 `image/png`，同时带登录令牌和可选幂等键。前端应以文件的原始二进制发送。

- 最大4MiB、1600万像素、单帧；每老人最多100张，每个被关联对象最多10张。
- 校验真实图片内容并重新编码JPEG，去掉EXIF/GPS和原始文件名。
- `GET /attachments?elder_id=`：权限内列表，支持 `limit/offset`。
- `GET /attachments/{id}`：元数据，不返回服务器文件名或公开URL。
- `GET /attachments/{id}/content`：带认证下载JPEG。前端可认证获取Blob再创建本机预览URL；不要将令牌拼入图片URL。
- 未审核照片仅上传人和管理人员可读；审核通过后当前同老人授权护理员可读；家属不能读取内部照片。

### 审核与关联

- `POST /attachments/{id}/review`：管理角色，`expected_revision,decision:approve|reject,note`。
- `POST /attachments/{id}/links`：`target_type:record|incident,target_id`；校验同老人、同入住批次和作者权限。
- 两接口支持幂等。照片文件保存在私有数据目录下，JSON只保存引用、来源、哈希、版本和审核留痕。

## 8. 图像辅助观察

配置独立的 `VISION_API_KEY,VISION_BASE_URL,VISION_MODEL,VISION_TIMEOUT_SECONDS`。可复用同一DeepSeek账号：密钥填现有DeepSeek密钥的实际值，地址`https://api.deepseek.com/v1`，模型`deepseek-flash`，超时45秒。独立配置项不代表必须另买账号。其他供应商须支持图片输入的HTTPS OpenAI兼容接口；不能将纯文字模型当作视觉模型。配置值只放私有环境，不入仓库。

- `GET /attachments/vision/status`：是否配置、模型及提示版本，不返回密钥。
- `POST /attachments/{id}/analyze`：支持幂等。生成持久化识别任务，调用模型时不持有JSON写锁；重复并发请求共享同次调用。
- `GET /attachments/analyses/{analysis_id}`：获取最新版本。
- `POST /attachments/analyses/{analysis_id}/review`：`expected_revision,decision:confirm|reject|request_management,observations:string[],note`；支持幂等。

输出限制为 `status,observations,missing_information,verification_items,requires_professional_review`；`unable_to_determine` 时观察必须为空。不接受置信分、诊断或处置字段。模糊或不确定的照片应返回无法判断，而不能输出“正常”。

每次返回固定提示：**AI识别可能有误，不构成诊断或处置建议，请人工核对。专业处理请由有权限人员审核决定。**

识别状态和人工状态分别显示：`model_status` 可为 `visible_observations/unable_to_determine/failed/unavailable/processing`；`status` 可为 `processing/pending_review/pending_management/confirmed/rejected/discarded`。

缺配置不返回假识别；失败允许人工补充观察或放弃。涉及专业审核的结果，护理员必须提交主管；主管权限不等于医疗执业资质，专业处置仍由有相应权限人员决定。

人工确认在同一事务中新建正式观察记录、关联原图和审核结果；该记录可作为以后老人印象的来源。不会自动生成诊断、事件分级、任务或长期偏好。处理中权限或入住批次变化则丢弃结果；中断超过180秒可显示失败并进行人工处理。

**2026-10-25补充：已用同一DeepSeek账号完成2项真实视觉接口验收（合成清晰图与过暗图），并通过人工修改、主管确认、原图记录关联、幂等和放弃路径；相关回归35项通过。真实养老照片效果、专业识别准确率与前端页面仍未验收。**

官方DeepSeek请求禁用思考模式并启用JSON对象输出，提示版本为`visible-observation-v2`；其他兼容供应商不携带DeepSeek专有参数。验收说明见`DEEPSEEK_VISION_2026-10-25.md`。

## 9. 家属简报

- 原人工简报接口与审核发布链路保留，见 `FAMILY_API.md`。
- `POST /family/summaries/suggest`：管理角色，`elder_id,admission_id,period_start,period_end,evidence,public_quotes_confirmed:true`。
- evidence使用现有引文结构；只将人工许可公开的选定引文送模型，不发送整个内部记录、账号和照片。
- 返回的是草稿；在原审核接口发布前，家属无法读取。重复幂等请求复用原草稿。
- `PATCH /family/summaries/{id}`：`expected_revision,text,reason`，只修改草稿并保存人工修改历史。
- 模型返回无效引用时503，提示手工填写，不保存或发布虚构内容。

## 10. 管理看板

`GET /reports/dashboard?start=2026-10-25&end=2026-10-26&elder_id=&shift_id=&status=`，仅管理角色。

返回：`as_of,timezone,filters,cards,distributions,task_trend,details,pending_work,comparison,excluded,definitions`。

- 卡片含 `count/items/previous_count/change/change_ratio`；上一窗口为相邻、相同天数，前值0时比例为null。
- `comparison` 返回上一窗口筛选与卡片明细。比较采用当前快照中的处理结果，不重建上周期末积压。
- 图表分组包含实际对象 `ids`，同次响应 `details` 可直接下钻，数量与明细一致。后续刷新可能因业务变化而不同。
- `pending_work` 去除重复卡片事项，按待人工分级、人工高风险、逾期、期限排序，带中文原因；不是AI风险评分。
- 日期北京时间左闭右开，最多366天。任务按计划服务时间，人工任务按期限或建立时间；交班按提交时间，事件按发生时间，其他按建立时间。
- 计划完成率只统计已生成、已到服务时间的计划事项；未来任务不进入分母，取消计入，补发链只计最终任务，零分母返回null。它不是全机构计划履约率。
- 班次筛选只认可直接班次或明确来源记录；跨班印象、无来源照片和反馈不能假定所属班次。
- 内部分布枚举需前端映射中文；未分级不能显示为低风险。

## 11. AI效果治理

- `GET /ai-governance/operations`：版本、调用耗时、失败、记录确认/人工修改/拒绝、照片审核情况。
- `POST /ai-governance/evaluations`：管理人员提交合成/脱敏样本人工标注，支持幂等。
- `GET /ai-governance/comparison?dataset_version=&feature=&split=development|holdout`：按共同样本比较版本，单列未配对样本。
- 标注字段见接口schema：样本哈希、版本、功能、模型与提示版本、预期/预测标签、核查/错误引用数、有效输出、耗时、隐私确认与说明。
- 精确标签对照计算误提/漏提与precision、recall、F1；引用错误单独统计，零分母null。
- 采纳率不能当准确率；开发集和留出集分开；同数据版本不可静默修改金标准。
- 运行日志只记元数据，不记密钥和原始照护输入。模型返回不代表业务校验通过。

## 12. 数据迁移、备份与联调顺序

JSON schema由5升级到6，无数据库。新集合为通知、照护分配、附件、视觉分析与AI评估。

在服务停止、环境指向正确私有数据目录的前提下，从 `backend/` 执行：

```powershell
.venv/Scripts/python.exe scripts/migrate_json.py
```

Linux使用虚拟环境对应的Python路径。脚本显式升级并创建备份；不要通过删除store.json解决版本提示，不要为联调清空现网数据。

备份JSON若含照片，会同时创建同名 `.attachments` 文件夹；复制备份必须成对保留。恢复检查哈希和文件完整性，并失效登录、清理通知、撤销旧分配，避免旧授权复活。恢复后主管重新分配照护范围。

前后端联调顺序：身份与分配 → 老人工作台/时间线 → 记录确认与任务 → 记忆与交班 → 安全事件/整改/通知 → 私有照片/视觉核对 → 家属草稿发布 → 看板下钻 → AI治理。每步通过再向后。

本轮未推送、未部署；DeepSeek真实视觉接口已用合成图片验收，前端接入、上线联调与真实养老照片效果仍需另行验证。详细自动化结果见同目录验收报告和视觉接入记录。

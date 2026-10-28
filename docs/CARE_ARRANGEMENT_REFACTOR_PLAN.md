# 生活照护安排分流：前后端修改与验收方案

日期：2026-10-28。范围：原有前端 `feat/frontend`，沿用 Vue、Vant、Element Plus 与现有权限、版本及幂等机制。本仓库没有后端源码；以下新增接口属于待双方确认的接入方案，不代表后端已经实现。前端在服务未声明支持时禁止提交新类型，不以本机保存冒充服务端成功。

## 1. 原代码差异与逐项修改

| 项目 | 原有行为 | 修改后行为 | 检验重点 |
| --- | --- | --- | --- |
| 采用方式 | 建议采用进入任务表单 | 先人工选择日常提示、本次提醒或跟进任务；AI仅推荐 | 未选择不显示业务表单、不提交；无自动采用 |
| 日常细节 | 要求班次、人员、截止与完成标准 | 场景＋照护提示，沟通、活动、用餐、午休等自然呈现 | 不带隐藏的排班及日期循环字段，不逐次打卡 |
| 本次照护 | 相对时间被迫填成精确时间 | 服务日期＋本次场景时机＋需要记录什么 | 只对这次有效；拒绝、休息、替代活动和无明确回应均可记录 |
| 跟进任务 | 沿用任务派发与执行 | 只有确需交付的事项进入任务；未分配明确标识 | 未分配不得显示已落实，不开放执行 |
| 提示状态 | 与任务状态混用 | 待确认、已启用、需调整、已停用独立管理 | 调整/停用需说明和版本校验；已停用不继续提示 |
| 统计与过程 | 多处直接遍历任务 | 明确排除提示/提醒，缺少类型的旧任务保持兼容 | 列表、工作台、交班、跟进、过程回放、完成率和逾期隔离 |
| 不支持/失败 | 容易显示空白或误报成功 | 能力检查、回执类型与老人核验、错误可重试 | 服务缺失提示；未知回执保留原幂等提交 |

## 2. 前端实施

1. 公共模块定义内容类型、场景、状态、自然记录文案、白名单请求构建与响应校验，覆盖正常、非法、旧版本与跨老人数据。
2. 建议卡片先选采用方式，对应展示不同字段。日常提示使用独立场景选择；本次提醒带服务日期；跟进任务保留必要交付字段。切换类型不泄漏隐藏任务字段。
3. 三步安排按类型预览与确认；非任务回执必须明确类型、提示/提醒条目，且 `created_tasks` 为空。旧后端仅允许跟进任务。
4. 共享场景提示组件接入老人今日安排、观察记录与相关任务上下文；管理入口独立于任务状态。读取异常明确提示，并清空旧老人数据。写入复用原有幂等与账号隔离机制。
5. 公共任务过滤覆盖两个端的服务、任务办理、交班及统计；直接请求及演示路径补同一约束。未知显式类型不得作为可执行任务。
6. 单元测试、两端类型检查、Lint、常规/部署/演示构建、浏览器验收。测试只用虚构资料。

## 3. 后端数据模型（待后端实现/确认）

建议使用独立 `care_guidance` 表保存提示和提醒，任务仍在 `care_tasks`；也可复用基础内容表，但查询和统计必须按 `content_type` 严格隔离。

- 公共字段：`id`、`elder_id`、`admission_id`、`content_type`、`title`、`revision`（正整数）、`created_by`、`confirmed_by`、`created_at`、`updated_at`、来源建议/记录编号及来源版本。
- 日常提示：`scene`（`communication/before_activity/activity/dining/rest/bathing/other`）、`instruction`、`status`（`pending/enabled/needs_adjustment/disabled`）。日常提示无任务截止、班次与负责人必填要求。
- 本次提醒：`occasion`（`before_activity/after_lunch/during_meal/during_communication/other`）、`service_date`（北京时间日期）、`record_what`、`status`（`active/recorded/cancelled/expired`）。服务端按日期和实际场景判定有效性，不自动形成长期记忆。实际回应保存为正式记录，关联提醒。
- 跟进任务：`content_type=followup_task`；保留任务状态、排班、负责人、执行时间、截止及执行前提。没有负责人时返回 `assignment_status=unassigned`，不允许开始/完成。待分配事项与已落实任务分别展示。
- 保存记录仅说明实际询问和回应；`declined/alternative/rest/unclear` 等结果不等于失败，不以同意参加作为完成要求。

## 4. 接口契约（待联调）

所有路径位于现有 `/api/v1`；所有写接口使用 `Idempotency-Key`，校验当前用户、老人范围、入住状态、来源和版本。冲突返回409，权限不足返回403；服务未开放返回404/501或不声明能力。

### 4.1 能力声明与分流采用

- `GET /elders/{elder_id}/care-advice` 与 `GET /elders/{elder_id}/arrangement` 增加 `supported_content_types: ["routine_hint", "one_off_reminder", "followup_task"]`；缺少该字段只兼容旧跟进任务。
- 建议可以返回 `recommended_content_type`，前端不自动选中。
- `POST /elders/{elder_id}/care-advice/{advice_id}/adopt`：共用 `expected_revision/content_type/reason/title`；日常提示传 `scene/instruction`，本次提醒传 `occasion/service_date/record_what`，跟进任务传原有 `task`。非任务请求禁止包含 `task`。
- 非任务采用回执保留建议的 `id/elder_id/revision/status=adopted`，额外返回 `content_type` 及 `guidance`（下述完整提示/提醒对象）；不得附带或创建任务。跟进任务仍返回关联 `task`。

### 4.2 三步安排

- 现有 `arrangement/preview`、`arrangement/confirm` 扩展 `content_type`。只有任务请求包含 `starts_on/ends_on/service_date/shift_id/assigned_to` 以及重复执行时间等字段；日常提示只包含 `title/goal/content_type/items`，本次提醒另带 `service_date`。
- 预览必须返回 `elder_id/content_type/context_token/items`；提示/提醒的 items 包含对应场景、提示或记录内容，不混入任务。后端令牌绑定老人、类型、内容、来源版本和人员时机。
- 确认返回 `plan`（含 `elder_id/content_type`）、`created_tasks`；非任务还返回 `guidance` 数组，任务数组必须为空。禁止旧实现忽略类型后默认派发任务。
- 提交、提示保存、关联记录及审计须原子完成；重复幂等键返回原回执，不重复创建。类型或上下文变化后必须重新预览。

### 4.3 场景提示与生命周期

- `GET /elders/{elder_id}/care-guidance` → `{elder_id, items:[...]}`。对象需包含上述类型必需字段；可选 `scene` 查询用于相关场景，前端也会过滤。管理人员返回可管理状态，护理员仅返回授权可见内容。
- `POST /elders/{elder_id}/care-guidance/{guidance_id}/status` 请求 `{expected_revision,status,reason}`。日常提示按四态变更，需人工确认；护理员可报告需调整，启用/停用由管理人员决定。返回更新后的完整对象。
- `POST /elders/{elder_id}/care-guidance/{guidance_id}/record` 请求 `{expected_revision,response,observation,happened_at}`。只接受仍有效的本次提醒；实际写一条正式照护记录并将提醒标记 `recorded`，返回 `{guidance, record:{id,elder_id,...}}`。不创建任务或长期偏好，允许拒绝、替代活动、休息与无明确回应。
- 本次提醒可通过 status 接口取消，服务端到期标记 `expired`；不会混用任务的 completed/overdue，也不计入任务完成率。
- 老人、记录页和任务页读取失败均显示“提示暂未读取/接口未支持”，不得当作确实没有提示；缓存依账号、老人及场景隔离。

### 4.4 查询、统计与迁移

- `/tasks`、工作清单 `open_tasks`、交班候选、任务回放与看板统计只返回/计算 `followup_task`。旧数据无类型字段按任务处理，新未知类型明确报错。
- 不改变历史任务ID、执行记录、交班关联与既有幂等键。历史生活细节仅生成人工待确认候选，不批量猜测迁移为长期习惯；真实记录不删除。
- 先备份，增量迁移、后端部署能力声明、前端验收；回滚时停用新入口而保留新数据。

## 5. 验收顺序与结果

逐项检查：类型选择 → 三类字段隔离 → 非任务预览/回执 → 生命周期 → 场景显示 → 旧任务兼容与统计 → 存储/失败/并发 → 两端浏览器回归 → 提交推送。

自动化结果与限制在本文件末尾补充。真实后端支持、数据库迁移和真实权限联调必须由后端在其仓库完成，不能用前端模拟结果替代。

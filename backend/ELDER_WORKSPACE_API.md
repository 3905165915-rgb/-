# 老人工作页 API（0.6.0 / schema 9）

所有路径以 `/api/v1` 开始。工作人员接口仍校验账号有效性和老人照护范围；管理操作限主管/管理员。家属不开放内部观察、评估或整理队列。

| 方法与路径 | 用途与约束 |
| --- | --- |
| `POST /elders/{id}/record` | `{text, shift_id?, happened_at?, scene?, attachment_ids?}` 先保存正式记录，再锁外同步分析；返回 `{record, analysis_status, analysis}`。支持 `Idempotency-Key`；AI失败返回 `analysis_status=failed`，已保存记录不撤销。 |
| `POST /elders/{id}/records/{record}/analyze` | 对同一正式记录重试分析，不重复创建记录。重新校验有效员工、老人照护范围、入住、记录修订和班次成员。 |
| `POST /elders/{id}/records/{record}/analysis/{analysis}/confirm` | `{expected_revision, preference_decisions, accepted_tasks}`；核对依据必须匹配当前原文/版本。喜好由提交人决定是否加入个人印象，不设重复频率门槛、不要求选择长期或临时。新任务须补齐老人、开放班次、负责人、未来截止和完成标准。支持幂等键。 |
| `GET /elders/{id}/organising` | 兼容读取旧作业。Schema 9 迁移将 queued/processing 的记录整理作业标记为 `failed/requires_inline_reanalysis`；新记录不再创建此类作业。 |
| `POST /elders/{id}/organising/{job}/retry` | 旧记录分析作业不再由 worker 消费；按记录ID使用 `/records/{record}/analyze`。 |
| `POST /elders/{id}/organising/{job}/resolve-followups` | 主管填写 `{reason}`，记录人工接续办理说明；不自动认定任务已执行。 |
| `GET /elders/{id}/understanding` | 返回已确认个人印象、待核实内容及原文依据；新增 `display_summary` 展示简短特性，`profile_summary_needed` 表示旧资料尚需生成摘要。未经确认内容不自动加入个人印象。 |
| `POST /elders/{id}/understanding/summarize` | 工作人员按权限整理已确认个人印象的展示摘要；锁外调用，提交时复核权限、来源、修订和演示批次。保留原内容、原句与历史，按记忆修订缓存，不改变照护要求。模型不可用时返回503，原资料不丢失。 |
| `POST /elders/{id}/understanding/{report}/{point}/decision` | `{expected_revision, decision: adopt或reject, content?, note?}`；主管核对后可加入个人印象，不再以支持天数或趋势标签限制喜好。专业关注仍走照护核验，来源变更仍阻止采用。支持幂等键。 |
| `POST /assessments/prefill` | `{elder_id, lookback_days?:90}`；只阅读本次入住、时间范围内最近30条正式观察。每项返回答案提议、逐字引文或具体观察问题；历史结果单独返回，不能自动当本次证据。 |
| `POST /elders/{id}/assessment/save` | 评估字段加 `action: save或submit或confirm`，更新时带 `assessment_id/expected_revision`。现场观察记录观察人和时间，版本自动管理。复合提交为单事务，失败不留下半份结果。支持幂等键。 |
| `POST /assessments/{id}/answers` | 更新可编辑草稿/待补充评估的逐项答案与依据，需当前版本；已确认历史不可覆盖。 |
| `GET/PUT /elders/{id}/automation` | 主管设置本次入住的普通跟进授权。PUT带当前版本、启用状态、允许动作和原因；默认关闭。 |
| `GET/PUT /elders/{id}/plan-automation` | 主管授权具体有效计划版本、真实班次与责任人；计划/依据/权限变化即阻止生成。 |
| `GET /decisions/me` | 汇总需主管决定的评估、资料矛盾、建议反馈、队列失败、未明确跟进、排期失败与任务接续事项。 |

照护建议沿用 `/elders/{id}/care-advice` 系列接口：整理、采用并创建任务、拒绝、执行反馈、主管复核。反馈记录中的关联不表示已证明因果效果。

## 2026-10-28 个人印象简化

记录提取使用可选的 `preference_candidates`（内容、原句、类别和表达者），每个喜好独立成项。`frequency` 字段仅为旧客户端保留，不作为加入门槛。前端统一使用“个人印象建议 / 加入个人印象 / 暂不加入”。“了解他”默认展示第三人称简短特性；原句、版本及人工核对集中到“原文核实”。

旧记忆的摘要写入可选 `presentation` 元数据，按原记忆修订关联，兼容 schema 9，无需重建数据。来源更正、撤权或记忆修订时，不得提交旧摘要。摘要不得添加新喜好或删除否定、条件和明确时限。原有权限、任务时间核验与家庭可见范围不放宽。

## 评估状态与证据

- `pending_observation`：可保存缺项，`total_score=null`，不能确认或作为计划依据。
- `draft`：条目已补齐，待主管确认；护理员可以提交主管。
- `confirmed`：主管确认后才按既有时效/入住/证据规则判断是否有效。
- `item_sources` 按项目关联现有正式记录；`direct_observations` 按项目填写现场观察。不得用另一项目的依据补齐本项目。
- 兼容旧客户端的一般引用字段，但新工作页使用逐项依据。系统不把没有记录理解为能够独立完成。

## 后台与部署

旧版记录整理队列仅供兼容展示，不再启动消费。计划排期仍由后台 worker 执行。新的即时记录保存不入队；模型调用在文件锁外，结果按记录修订保存，失败可重试同一记录。普通跟进还需核对授权、完整原句、唯一责任人、明确日期时刻、实际班次和重复任务。

schema 8 到 9 增加 `record_analyses`，先备份，再将旧 queued/processing 记录作业迁为显式失败；其他作业、集合、账号和业务对象保留。旧 schema 迁移仍显式执行。恢复备份会撤销旧自动化授权，防止已撤销权限因旧快照复活。

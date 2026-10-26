# 老人工作页 API（0.5.0 / schema 8）

所有路径以 `/api/v1` 开始。工作人员接口仍校验账号有效性和老人照护范围；管理操作限主管/管理员。家属不开放内部观察、评估或整理队列。

| 方法与路径 | 用途与约束 |
| --- | --- |
| `POST /elders/{id}/record` | `{text}` 保存正式记录，自动关联当前入住；同事务入后台队列，返回记录和排队状态。支持 `Idempotency-Key`，AI失败不撤销正式记录。 |
| `GET /elders/{id}/organising` | 返回最近20项整理作业和处理结果；原始记录保存与后台状态分别展示。 |
| `POST /elders/{id}/organising/{job}/retry` | 仅重试失败作业，重新校验权限和来源版本。 |
| `POST /elders/{id}/organising/{job}/resolve-followups` | 主管填写 `{reason}`，记录人工接续办理说明；不自动认定任务已执行。 |
| `GET /elders/{id}/understanding` | 返回已确认信息、近期观察、待复核信息及原文依据。未经确认的观察不覆盖正式要求。 |
| `POST /elders/{id}/understanding/{report}/{point}/decision` | `{expected_revision, decision: adopt或reject, content?, note?}`；主管一次采用即可创建并确认记忆。仅来源仍有效的长期趋势允许采用；临时意愿、矛盾和专业关注不能直接升级。支持幂等键。 |
| `POST /assessments/prefill` | `{elder_id, lookback_days?:90}`；只阅读本次入住、时间范围内最近30条正式观察。每项返回答案提议、逐字引文或具体观察问题；历史结果单独返回，不能自动当本次证据。 |
| `POST /elders/{id}/assessment/save` | 评估字段加 `action: save或submit或confirm`，更新时带 `assessment_id/expected_revision`。现场观察记录观察人和时间，版本自动管理。复合提交为单事务，失败不留下半份结果。支持幂等键。 |
| `POST /assessments/{id}/answers` | 更新可编辑草稿/待补充评估的逐项答案与依据，需当前版本；已确认历史不可覆盖。 |
| `GET/PUT /elders/{id}/automation` | 主管设置本次入住的普通跟进授权。PUT带当前版本、启用状态、允许动作和原因；默认关闭。 |
| `GET/PUT /elders/{id}/plan-automation` | 主管授权具体有效计划版本、真实班次与责任人；计划/依据/权限变化即阻止生成。 |
| `GET /decisions/me` | 汇总需主管决定的评估、资料矛盾、建议反馈、队列失败、未明确跟进、排期失败与任务接续事项。 |

照护建议沿用 `/elders/{id}/care-advice` 系列接口：整理、采用并创建任务、拒绝、执行反馈、主管复核。反馈记录中的关联不表示已证明因果效果。

## 评估状态与证据

- `pending_observation`：可保存缺项，`total_score=null`，不能确认或作为计划依据。
- `draft`：条目已补齐，待主管确认；护理员可以提交主管。
- `confirmed`：主管确认后才按既有时效/入住/证据规则判断是否有效。
- `item_sources` 按项目关联现有正式记录；`direct_observations` 按项目填写现场观察。不得用另一项目的依据补齐本项目。
- 兼容旧客户端的一般引用字段，但新工作页使用逐项依据。系统不把没有记录理解为能够独立完成。

## 后台与部署

普通记录没有个性化/跟进线索时不调用模型。相关整理限制在当前入住最近30条，排除交班和摘要重复引用；同日同文事件去重。后台可恢复，模型调用在文件锁外，提交时重查权限、入住、版本和原文。普通跟进还需核对授权、完整原句、唯一责任人、明确日期时刻、实际班次和重复任务。

schema 7 到 8 增加 `care_jobs`、`automation_rules`，保留原账号和业务对象。恢复备份会撤销旧自动化授权，防止已撤销权限因旧快照复活。单 worker 部署；`BACKGROUND_JOBS_ENABLED=false` 仅用于隔离测试或显式停用后台。

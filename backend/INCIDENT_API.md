# 不良事件与整改复查

接口均在`/api/v1`，后端本地实现，未联调部署。schema仍为4，使用已有incidents/rectifications集合。

- GET/POST `/incidents`、GET `/incidents/{id}`：员工上报description、immediate_action、occurred_at、elder_id、当前admission_id和evidence。reported只是人工报告，不等于确认事故。护理员仅看自己报告或当前负责整改的事件；家属禁止访问。
- POST `/incidents/{id}/triage`：主管expected_revision、category、severity、classification_basis、assigned_to、due_at、corrective_plan、evidence、reason。10种演示类别；严重度low/medium/high由主管按机构规则判断，不代表法定事故等级。创建一个关联整改单；重分级保留前版，退回待执行状态。
- POST `/rectifications/{id}/assign`：主管expected_revision、assigned_to、due_at、reason，重新指派后须重新提交。
- POST `/rectifications/{id}/submit`：仅当前责任人，expected_revision、expected_incident_revision、result、evidence。提交保存证据快照，允许再次提交修正来源，但保留全部旧提交。
- POST `/rectifications/{id}/review`：另一位主管，expected_revision、expected_incident_revision、decision=accept/return、note。禁止自审；关闭时复查当前事件与提交来源版本，否则409。return回到assigned。
- POST `/incidents/{id}/reopen`：主管expected_revision、expected_rectification_revision、assigned_to、due_at、reason，明确重开；已关闭历史保留。

所有写接口支持Idempotency-Key，revision做乐观并发检查，同事务保存对象、审计和幂等结果。来源须同老人同入住、当前正式记录版本与真实引文；更正使旧证据失效，先主管重核分类和依据，再重新提交。已关闭后来源变动只标识证据不再当前，不自动改变历史关闭结论，需主管明确重开。

离院不清除未完成整改，仍可依据原入住当前证据履责；再次入住的新记录不能冒充旧入住整改证据。存在未关闭整改责任时禁止停用员工，先转交。不是紧急救助/法定事故上报系统，也不做AI自动定级、自动关闭、电子签或自动家属告知。

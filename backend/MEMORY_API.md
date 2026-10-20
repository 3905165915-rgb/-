# 个性化照护记忆接口交接稿（0.3.2）

本模块对应2026-10-19创业方案的“个性化照护记忆”。所有路径统一加 `/api/v1`，使用Bearer登录。由前端协作者确认后接入。0.3.0实现人工候选与确认基础；0.3.1追加AI候选提取与上下文新接口，具体流程见[ASSISTANT_API.md](ASSISTANT_API.md)，普通旧记录接口继续保持原文提取行为。

## 可用接口

| 方法 | 路径 | 权限与用途 |
|---|---|---|
| POST | `/memories` | 工作人员；提交候选，201；不能指定确认人或状态 |
| POST | `/memories/from-draft` | 已确认上下文草稿的作者或管理人员；明确选中AI候选，仍只生成candidate |
| GET | `/memories?elder_id=...` | 工作人员；按老人查管理列表，可加status/scene/limit/offset |
| GET | `/memories/context?elder_id=...&scene=bathing` | 工作人员；只返回该场景下当前可用的确认信息 |
| GET | `/memories/{id}` | 工作人员；当前版本及有效性标记 |
| GET | `/memories/{id}/history` | 工作人员；变更前后快照；支持limit/offset |
| POST | `/memories/{id}/revisions` | 提交者或管理人员；完整替换内容，重新进入candidate |
| POST | `/memories/{id}/review` | 仅admin/supervisor；确认、转复核、驳回或停用 |

家属当前不能访问本模块；后续单独实现老人绑定与家属可见范围。当前工作人员权限继承单机构演示版角色规则，尚非逐老人授权或多机构隔离。

## 创建候选

先通过人工录入或AI草稿人工确认取得正式记录编号及revision，再提交：

```json
{
  "elder_id": "E1",
  "content": "更喜欢下午洗澡",
  "category": "stable_preference",
  "scenes": ["bathing"],
  "attributed_to": "elder",
  "source_record_id": "从正式记录接口取得",
  "source_revision": 1,
  "source_field": "observations",
  "source_quote": "老人本人说更喜欢下午洗澡",
  "valid_from": null,
  "expires_at": null,
  "review_due_at": null
}
```

所有示例均为虚构；source_quote必须是实际记录对应字段中的连续逐字片段。不能直接引用未确认AI草稿，不能引用其他老人的记录，不能引用旧revision。`source_field`默认observations，也可为raw_text；一旦记录已更正，必须引用当前observations，不能用仍保留的旧raw_text恢复旧信息。

`attributed_to`区分elder/family/staff/unknown，是工作人员填写并核实的信息来源身份，不是系统验证过的发言人身份。原文存在不等于内容属实，引用校验也不能证明语义判断正确；主管须核对归属、否定、条件和适用期限。

| 字段 | 取值与约束 |
|---|---|
| content | 1–1000字；源引用1–5000字 |
| category | stable_preference稳定偏好；temporary_wish临时意愿；communication沟通方式；observation待核实观察 |
| scenes | bathing洗浴、dining饮食、activity活动、communication沟通、rest休息、other其他；至少1项，不重复 |
| valid_from | 可空，空时取提交/修订时刻；允许未来生效 |
| expires_at | 临时意愿必填；应晚于valid_from；其他类别可按实际范围设置 |
| review_due_at | 可选复核提醒，应晚于valid_from；提醒到期不会自动作废长期偏好 |

时间必须带时区，如`2026-10-19T20:00:00+08:00`。提交临时意愿时不允许客户端省略期限，让系统猜“今天”到什么时候。观察类即使经主管确认也不进入可执行偏好查询；确认观察存在，不代表已证实偏好变化。不同来源的信息可以共存，当前不实现冲突合并、自动优先级或医疗决策。

## 人工审阅与修订

审阅正文：

```json
{
  "action": "confirm",
  "expected_revision": 1,
  "reason": "已与本人核对，并确认适用于洗浴场景"
}
```

| action | 允许的原状态 | 结果 |
|---|---|---|
| confirm | candidate/review_required | confirmed，记录主管和时间；来源必须仍是当前版本，不能已到期或已离院 |
| request_review | confirmed | review_required，停止场景调用 |
| reject | candidate/review_required | rejected，保留历史，不可复活 |
| retire | confirmed/review_required | retired，保留历史，不可复活 |

修订正文为创建示例除elder_id之外的完整内容，另加`expected_revision`及必填`reason`。不提供的可选时间按空值处理，valid_from空值重新取当前时间；需保留原时间时显式回传。修订不可换老人编号，必须重新选择当前有效来源；任何修订都会清除当前确认标记并退回candidate，不能直接覆盖已确认偏好。驳回/停用为终态，需要重新采集时新建候选。

创建、修订、审阅均支持`Idempotency-Key`（1–128字符）。同用户、同操作、同key与正文重试返回首次结果；相同key不同正文409。不提供key时，版本校验仍可防止并发覆写，但创建请求可能重复。幂等返回是当时操作的快照，**判断当前可用信息必须重新GET详情或context**。

## 响应与有效性

创建/详情/审阅/修订返回：id、elder_id、content、category、scenes、attributed_to、source、status、revision、三个适用时间、created_by/created_at/updated_at、confirmed_by/confirmed_at，以及：

- `source`：record_id、revision、field、quote、snapshot_text、record_status、captured_at；历史来源快照不被记录更正覆盖。
- `source_current`：引用是否仍匹配当前正式记录版本和内容。
- `effective`：是否当前可作为场景提醒使用。它不代表医学上安全或专业计划批准。
- `blocked_reasons`：not_confirmed、source_changed、not_yet_effective、expired、observation_only、elder_inactive中的零到多项。
- `review_due`：到复核提醒时间；保留单独标记，不自动将长期偏好变成失效。
- `candidate_source`：可空；如来自AI候选选择，保存最初draft_id/candidate_index/provider，后续人工修订仍保留初始来源。

context返回`{elder_id, scene, as_of, memories: [...]}`，只含effective=true且匹配scene的项目。当前不开放任意历史时间查询，不返回其他老人信息。到期依据服务器当前时间计算，不用定时任务改变历史；到期项目保留confirmed历史状态，但effective=false。多个有效信息也不意味着相互一致，使用者仍应核对当前意愿。

`history`按变更顺序返回previous_revision、revision、action、reason、created_by、created_at、before、after。初始提交另有create_memory审计；`/items/{memory_id}/timeline`可串联提交、确认、修订、来源更正，老人及来源记录时间线也关联记忆事件。

## 与已有链路的连锁反应

1. 语音→文字校对→AI草稿/人工记录→正式记录，沿用既有接口。
2. 工作人员从正式记录提出记忆候选；此时不进入服务提醒、不生成任务。
3. 主管确认后，前端可在相应服务开始前调用context；仍需人工判断当前意愿。
4. 来源记录更正时，在同一JSON写事务内将其全部非终态关联记忆转review_required，revision递增、留痕；若写失败，记录与记忆一起不提交。
5. 获取context时还会再次检查来源，即使外部错误导入绕过正常更正入口，也排除过时引用。
6. 需要恢复使用时，以新来源revision和当前观察重新修订，再由主管确认。不能对旧依据反复点击确认恢复。

0.3.1已实现新上下文接口中的AI候选发现与有效信息注入，且必须先确认正式记录、明确选择候选、再经主管确认，不自动生效。0.3.2实现任务人工采用/撤回的版本快照及当前差异查询，见TASK_MEMORY_API.md。**尚未实现**：拒绝次数触发复核、有效计划检索，以及记忆变化→历史任务/交班的完整核验队列。不能宣称“完整AI记忆引擎”或“全量变更追踪”。

## 错误与升级

401/403遵循主API约定。404：memory_not_found/record_not_found/elder_not_found。409：stale_revision、memory_source_revision_changed、invalid_memory_transition、memory_is_terminal、memory_not_confirmable、idempotency_key_payload_mismatch。422：memory_source_elder_mismatch、memory_requires_confirmed_record、memory_quote_not_in_current_source、corrected_source_requires_observations、invalid_memory_time_window等；字段校验也可能返回FastAPI detail数组。

0.3.0以JSON schema3新增care_memories集合；当前0.3.3已升级为schema4并增加change_reviews集合，见CHANGE_REVIEW_API.md。先停服、备份旧代码及数据，在服务环境中运行`scripts/migrate_json.py`，再启动。v1/v2/v3→v4迁移保留旧数据，拒绝损坏集合；不能用新代码直接启动旧schema文件，也不能用seed重置线上状态。

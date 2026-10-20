# 任务采用个性化记忆的版本关系（0.3.2）

对应BACKLOG第3项。工作人员明确采用某条记忆时，保存对象编号、版本、当时内容与来源、确认信息、采用人及理由。旧依据保持原样，当前状态另外读取。它记录“工作人员选择参考这条信息”，不证明照护服务已实际完成，也不证明该偏好属于专业照护方案。

AI context_notes里的引用只证明生成时使用过对应资料，**不是工作人员已采用的证据**。本模块不自动把AI引用转为任务采用关系，不依据模型输出更改任务。

## 接口与权限

所有路径加`/api/v1`，使用Bearer鉴权；前端协作者确认新增合同后接入。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/tasks/{task_id}/memory-references` | 明确采用一个当前有效版本，201 |
| GET | `/tasks/{task_id}/memory-references` | 查看历史快照和当前是否需要核对；不会写入数据 |
| POST | `/tasks/{task_id}/memory-references/{reference_id}/withdraw` | 撤回采用关系，保留原始依据与理由 |

读取继承现有单机构工作人员权限；family无权限。写入仅管理人员或任务负责人；未分配任务允许工作人员操作，与现有任务执行规则一致。有关联班次时须班次未关闭，护理员须是该班成员。每次写入在JSON事务内复查有效账号及角色、负责人、班次和版本。

已经completed/cancelled的任务不能追加或撤回采用关系，避免事后补造证据。not_done事项可以核对采用关系，但采用本身不会自动恢复任务或改变未执行原因。

## 明确采用

先读取任务revision，再从`GET /memories/context?elder_id=...&scene=...`获取可用信息及其revision。示例编号仅为占位：

```json
{
  "expected_task_revision": 1,
  "memory_id": "MEM-example",
  "expected_memory_revision": 2,
  "scene": "activity",
  "reason": "安排活动前参考本人已核实习惯，仍须询问当前意愿"
}
```

后台要求：老人编号一致、场景适用、记忆与来源仍有效、版本未变化。未确认、待复核、观察类、未来生效、已到期或来源更正的信息不能新采用。复核提醒到期但长期偏好仍有效时，不自动判为失效，另保留review_due提示。任务尚无结构化服务场景字段，因此scene由工作人员明确选择，后台验证它属于记忆适用范围；暂不能自动证明任务语义与scene匹配。

服务端生成reference_id、采用时间、采用人及snapshot。客户端不能提供snapshot、确认人或采用时间；普通记录的task_candidates也不能携带memory_references绕过此接口。

同一任务、同一memory_id同时最多一个active关系。已采用旧版本时，即使当前记忆有新版本，也必须先撤回旧关系，再重新核对后采用，不能无声替换。最多10个active关系；历史关系不硬删除。

## 返回与当前核验

三个接口都返回TaskMemoryResponse：

```json
{
  "task_id": "TASK-example",
  "task_revision": 2,
  "task_status": "pending",
  "historical_only": false,
  "as_of": "2026-10-19T08:00:00Z",
  "needs_review": false,
  "references": []
}
```

references中每项包括：

| 字段 | 含义 |
|---|---|
| id/memory_id/memory_revision | 采用关系编号、记忆编号与当时版本 |
| scene/reason/adopted_by/adopted_at | 采用场景、理由、实际操作者与服务器时间 |
| snapshot | 当时内容、类别、归属、适用范围、有效期、确认人、原始来源记录/版本/逐字引用；不被后续记忆更新覆盖 |
| status | active或withdrawn；这里的active表示关系尚未撤回，不表示记忆现在仍有效 |
| withdrawn_by/withdrawn_at/withdrawal_reason | 撤回信息，未撤回时为空 |
| current | 当前版本、状态、有效性、来源有效性、复核到期、outdated与原因；不覆盖snapshot |
| needs_review | 对未结束任务、未撤回关系，当前依据已变化或不再有效时为true |

current.reasons可能包含memory_revision_changed、scene_no_longer_applicable、memory_missing、memory_elder_mismatch，以及memory_not_confirmed/memory_expired/memory_source_changed等记忆失效原因。即便新版内容完全相同，revision变化也要求显式核对，程序不会猜测新旧版本等价。

已完成/取消任务`historical_only=true`，即便current.outdated=true也不会自动转为待执行或产生新的执行要求，顶层needs_review为false。原始依据仍可用于回溯。withdrawn关系也不计入当前待核验，但保留当时快照及当前差异。

当前核验只反映读取时的状态，不是后台整改工单。程序不自动改任务内容、改负责人、取消任务或认定照护错误；完整的影响队列、指派复核和关闭结论仍属后续阶段。

## 撤回与重新采用

```json
{
  "expected_task_revision": 2,
  "reason": "已核实本人习惯变化，撤回旧依据后重新选择"
}
```

撤回只改变关系状态和撤回元数据，snapshot不变；任务revision递增。要改用新版本，用最新任务revision和当前memory_revision再次调用采用接口。两次操作各自留痕，中间不会假装已经采用新版。

采用/撤回均支持Idempotency-Key（1–128字符）。同用户同操作同key同正文返回首次结果；同key不同正文409。版本校验防止并发覆盖。幂等重试返回的是当时响应，当前状态须重新GET；更换key重复采用已active关系仍409。

## 与现有链路的关系

- 采用和撤回都会增加任务revision，使尚未提交的交班草稿触发现有刷新要求。
- 交班条目保存当时任务memory_references的深拷贝；原任务跨班沿用编号与采用关系。下一班可以在自己的任务权限内撤回，既有交班快照保留原样。
- 原任务详情、列表与完成接口新增memory_references字段，保存关系的原始快照；**动态current与needs_review请调用专用GET接口**。普通任务返回中的active不能当作依据当前有效的证明。
- 老人、任务、记忆时间线可追踪采用与撤回事件及reference快照。来源更正或记忆停用不会修改旧采用快照。
- 上下文AI助手对相关待办增加memory_reference_checks，只带采用编号、使用版本、当前版本和需要核对的原因；不把已失效记忆的旧内容重新作为当前有效信息注入。AI提示仍需人处理，不等于已整改。
- 此接口的交班AI摘要仍主要基于既有交班文字；采用关系快照供结构化明细查看。0.3.3已增加任务采用记忆的影响定位、指派、处理和复查关闭，见CHANGE_REVIEW_API.md，仍无消息推送。0.3.5另加入条件待办核验与跨班重新认领，见TASK_CONDITION_API.md。

## 错误与存储

401/403沿用主API；404：task_not_found、memory_not_found、task_memory_reference_not_found。409：stale_revision、task_memory_revision_changed、task_memory_not_effective、task_memory_already_active、task_is_terminal、shift_closed、task_memory_reference_already_withdrawn、idempotency_key_payload_mismatch。422：task_memory_elder_mismatch、task_memory_scene_mismatch、too_many_active_task_memories，以及字段校验错误。

0.3.2的采用关系作为任务的可选字段保存，无新集合。旧任务缺少此字段时按空数组读取，不补造历史。当前0.3.3新增变更影响队列，JSON schema已升级为4，v1/v2/v3均须停服后显式迁移，见CHANGE_REVIEW_API.md。当前是单机构JSON演示版，逐老人授权、多机构隔离、历史容量治理与前端联调仍未验收。

# 上下文AI记录与个性化候选接口（更新至0.3.7）

本阶段对应BACKLOG第2项的可运行基础：当前原文提取、已确认记忆与未完成事项检索、附引用的历史提醒、候选单独提交。0.3.7增加有效照护计划的场景检索，仍不自动修改计划、任务或既有偏好，不进行完整冲突或医学判定。前端协作者确认此新增接口后再接入；现有普通记录接口保留。

## 1. 生成上下文草稿

工作人员调用`POST /api/v1/records/context-extract`，Bearer鉴权。示例均为虚构，elder_id/shift_id需从实际接口取得：

```json
{
  "elder_id": "E1",
  "shift_id": null,
  "scene": "activity",
  "text": "老人本人说今天不想参加活动，想先休息。"
}
```

`text`为1–5000字，scene取bathing/dining/activity/communication/rest/other。可传实际班次编号，护理员必须属于该班，关闭班次不能生成。家属不能调用，也不能由客户端提供sources、确认人或自定义系统提示词。

后端选择：

- 同一老人、同一场景、已确认且当前有效的个性化信息；排除未确认、待复核、观察类、未生效、到期、来源已更正的信息。
- 同一老人未完成的事项；传shift_id时只选该班。护理员只选本人及未分配事项，管理人员可读取该范围内所有负责人事项。状态包括pending/in_progress/not_done/overdue，不自动恢复not_done事项。
- 待办原有条件、原文时间、人工设定期限、未执行原因和结果说明。不从模糊文字推断精确时间，不执行任务。
- 0.3.7起，计划任务带plan_check当前依据元数据；同老人、同场景、当前已审批且有效的计划事项作为独立kind=plan来源，含目标、事项、评估编号/版本，不发送完整评估证据。计划到期/停用、评估到期/替代/来源更正、入住变更后重新选择上下文，不能沿用旧草稿。详见PLANNING_API.md。
- 0.3.5起，已有条件文本的待办另带condition_check当前人工核验元数据（标准、核验人、状态、有效期与拦截原因），不发送核验证据全文；来源更正/到期使上下文改变，旧草稿需重新生成。模型不能自行判定条件满足或自动执行。原任务的独立核验接口及跨班责任见TASK_CONDITION_API.md。
- 班次起止与状态；不发送老人姓名、家属电话、员工密码或整份档案。调用者输入本身的个人信息尚无自动脱敏，演示只用虚构文字。

个性化记忆最多30条、待办最多30条，每个source.text至多5000字，上下文JSON至多30000字符。超出返回422，不静默截断原文、条件或否定。可先选择实际班次缩小待办范围；本版不支持自动分批或长历史搜索。

`coverage.care_plans=effective_scene_filtered`表示选择当前有效、匹配服务场景的已审批计划事项；没有匹配项时sources中不会出现plan。`coverage.task_scenes=not_classified`仍表示待办未统一按服务场景归类，不把所有同老人待办都说成当前场景的必做服务。包括计划来源在内仍受单条5000字及上下文30000字符上限约束，不静默截断。

## 2. 草稿返回与三类内容

沿用AIDraft结构（id/raw_text/observations/task_candidates/evidence/warnings/provider/status等），新增可选字段：

| 字段 | 内容 |
|---|---|
| generation_kind | 普通旧流程为record，新流程为context_record |
| memory_candidates | AI提出的个性化候选，最多10项；数组下标用于后续人工选择 |
| context_notes | 历史提醒或待核实项，最多10项，每项必须引用本次输入上下文中的source_id与逐字quote |
| context_snapshot | 老人、场景、实际班次、生成时刻、输入来源及版本、覆盖限制、指纹和请求者；保留当时快照 |

当前原文事实放observations，历史提醒放context_notes，待核实个人信息放memory_candidates。**历史资料不自动成为本次已发生事实。** 三类输出在界面中分开展示；context_notes本身也只是建议，不能自动认定事实冲突、偏好变化或医学风险。

memory_candidates示例：

```json
{
  "content": "今天想休息，不参加活动",
  "category": "temporary_wish",
  "scenes": ["activity"],
  "attributed_to": "elder",
  "evidence_text": "老人本人说今天不想参加活动，想先休息。",
  "validity_text": "今天"
}
```

模型只能给出原文中的validity_text，不能生成expires_at。evidence_text须逐字出现在本次原文和至少一项observations中。category与发言来源仍由人核实；程序检查引用存在，不保证模型分类与语义解释正确。

context_notes示例（编号与引用应使用实际返回值）：

```json
{
  "kind": "check_needed",
  "text": "请核对本人当前意愿与过去习惯的适用时间。",
  "citations": [
    {"source_id": "memory/MEM-example/v2", "quote": "平时愿意参加上午活动"}
  ]
}
```

source_id包含类型、对象编号与版本；context_snapshot.sources保留source_id/object_id/revision/text及适用范围。AI引用不是任务已采用某记忆的证明；0.3.2另有明确人工采用接口，见TASK_MEMORY_API.md。相关待办可带memory_reference_checks说明采用版本与当前版本的差异，不把过时的旧记忆正文重新作为当前有效信息注入。

## 3. 人工确认正式记录

继续使用`POST /api/v1/records/{draft_id}/confirm`，原请求与返回不变。人工核对本次事实和候选任务后确认；仍只生成正式记录与明确选择的任务，**不会自动创建任何照护记忆**。

对context_record，保存AI结果前及人工确认前均重新选择上下文并核对指纹。相关偏好停用/到期、来源更正、待办变化、新信息进入有效范围或班次变化时，返回409要求重新生成；请求者停用/角色变化或失去班次权限时按403等实际权限错误返回。管理人员不能跳过上下文过期检查。已确认草稿的重复确认保持原有幂等语义，不重写历史。

过期的pending_review草稿可以通过原有放弃接口留痕，再生成新草稿。不能反复点击提交强行覆盖；AI不可用时原始文字仍可走`POST /records/manual`。

## 4. 人工选中个性化候选

确认正式记录后，作者或管理人员调用`POST /api/v1/memories/from-draft`：

```json
{
  "draft_id": "AI-example",
  "candidate_index": 0,
  "expected_record_revision": 1,
  "valid_from": null,
  "expires_at": "2026-10-19T20:00:00+08:00",
  "review_due_at": null
}
```

示例期限只说明格式，实际必须由工作人员根据本人意愿填写，且晚于生效时间。临时意愿不填expires_at返回422。有效期不从“今天”“晚点”自动计算；普通偏好可按实际情况留空期限。

后台确认：原草稿是已人工确认的context_record、当前人员可访问、候选下标存在、正式记录属于同老人、记录revision匹配，并且候选引用仍在**当前正式观察**中。人工确认记录时若已删除这句观察，不得仅凭AI草稿的旧引用生成记忆。

成功201返回MemoryResponse，状态仅为candidate。candidate_source保存最初的draft_id/candidate_index/provider，不意味着后续人工修订内容全由AI产生。此时未生效，须主管通过原有`POST /memories/{id}/review`确认后才进入场景检索。

该接口支持Idempotency-Key。同key同正文重试返回首次结果；相同候选已提交后换key或不带key再次提交返回409，避免重复候选。终态记忆也保留此来源关系，重新采集新事实应生成新草稿。需编辑内容、归属或场景时使用现有记忆修订接口，保留历史并重新确认。

## 5. 前端联调顺序

1. 护理员确认老人、实际班次和场景，语音转写先校对，再调用context-extract。
2. 分开展示本次事实、个性化候选、历史提醒；可展开来源和限制，默认不选中记忆候选。
3. 人工核对后调用原记录confirm，获取正式记录revision。
4. 用户明确选中某候选并填写适用期时，调用memories/from-draft；未选中的不提交。
5. 主管查看来源与范围，确认或驳回；护理员下次服务调用memories/context。
6. 来源更正时沿用上一版规则转待复核，不直接用AI覆盖长期偏好。

## 6. 失败、兼容和边界

- 503：厂商不可用或输出未通过结构/引用校验；本新接口不自动降级为Mock，不保存假成功草稿。
- 409 assistant_context_changed：上下文已变，重新读取、核对后生成；assistant_context_missing表示快照缺失。
- 422 assistant_scope_too_large：上下文超限；字段校验还可能返回FastAPI detail数组。
- from-draft常见409：memory_requires_confirmed_context_draft、memory_candidate_already_submitted、memory_source_revision_changed；422：invalid_memory_candidate_scope_or_expiry、memory_quote_not_in_current_source；404：memory_candidate_not_found。
- 作者之外的护理员不能提交他人AI候选。家属无此接口权限。老人级授权与多机构隔离仍未实现，继续按单机构演示使用。
- 原`POST /records/extract`仍只处理原文，不自动引入历史上下文；旧草稿读取时新字段使用空数组/null/record默认值。
- 0.3.1本身未新增集合；当前0.3.3已将JSON schema升级为4，v1/v2/v3均须停服后执行迁移脚本，见CHANGE_REVIEW_API.md。未完成前端联调和服务器部署不能宣称已上线。
- Mock明确标识演示，不自动编造候选。自动测试使用模拟厂商响应验证接口与状态约束，不代表已验证真实DeepSeek效果、方言效果、护理质量或商业收益。

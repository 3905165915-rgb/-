# 评估与照护计划接口（0.3.7）

第7项首版后端交接稿，供前端协作者确认；统一前缀`/api/v1`，Bearer鉴权。继续单服务器JSON，复用assessments/care_plans/care_tasks集合，schema仍为4，已有v4无需新迁移。没有自动补写历史、定时任务或线上发布。

## 本版的实际范围

实现人工ADL评估→主管确认及人工机构照护档位→计划草稿→主管审批→按日期/实际班次生成待执行清单→人工执行/交班；来源更正、复评到期、新评估替代、计划变更/停用、离院再入住会阻止沿用失效计划执行。旧版本和任务源快照保留，不自动完成、不静默改成新安排。

量表只内置`barthel_basic_v1`：通用10项、0–100分的Barthel ADL计分演示配置。参考[Shirley Ryan AbilityLab Barthel Index](https://www.sralab.org/rehabilitation-measures/barthel-index)，2026-10-20核对该资料的10项/最高100分信息；界面条目描述是摘要，未声称复刻完整临床操作手册。机构使用前须确认实际评估方法和培训。

**本版不是GB/T 42195综合老年人能力评估，不从Barthel分数自动推导法定护理等级、收费、补贴、长护险资格或诊断。**护理等级标签及其机构依据由主管明确填写，不能把演示机构标签表述为官方认定。Braden、跌倒、营养、走失和认知等其他量表及本地标准映射尚未实施。

## 12个新增接口操作

| 方法 | 路径 | 权限/内容 |
|---|---|---|
| GET | `/assessments/templates` | 工作人员；模板版本、题目选项、计分范围和限制 |
| GET | `/assessments` | 工作人员；elder_id/limit/offset，护理员不可见他人草稿/驳回件 |
| GET | `/assessments/{id}` | 工作人员；同上权限，含来源快照及实时current |
| POST | `/assessments` | 工作人员；人工评估草稿，201 |
| POST | `/assessments/{id}/review` | 管理人员；确认/驳回/停用 |
| GET | `/care-plans` | 工作人员；elder_id/limit/offset，护理员不可见草稿/驳回件 |
| GET | `/care-plans/{id}` | 工作人员；同上权限，含审批和评估快照 |
| POST | `/care-plans` | 管理人员；计划草稿，201 |
| POST | `/care-plans/{id}/review` | 管理人员；审批/驳回/停用 |
| POST | `/care-plans/{id}/generate` | 管理人员；明确日期和实际班次生成待办，200 |
| POST | `/care-plans/{id}/reissue` | 管理人员；人工确认补发已取消的计划任务，201 |
| GET | `/tasks/{id}/plan-check` | 工作人员；当前计划依据是否可用，历史任务也可查 |

admin/supervisor为管理人员，工作人员另含caregiver。family全部拒绝。列表默认limit=100，最大200，offset默认0。写入均支持Idempotency-Key，并在事务内复查当前账号及原角色；重复同key同正文返回原响应，同key不同正文409。读取实时状态不修改JSON。

## 一、评估的提交与复评

先取得模板和一份同老人正式记录，再POST `/assessments`。下例编号须替换为实际接口返回值：

```json
{
  "elder_id": "E1",
  "template_id": "barthel_basic_v1",
  "scores": {
    "feeding": 5, "bathing": 0, "grooming": 5, "dressing": 5,
    "bowels": 10, "bladder": 10, "toilet": 5,
    "transfer": 10, "mobility": 10, "stairs": 5
  },
  "assessed_at": "2026-10-20T09:00:00+08:00",
  "review_due_at": "2026-11-20T09:00:00+08:00",
  "note": "人工逐项观察，核对本人需要帮助的情况",
  "evidence": [{
    "record_id": "实际正式记录ID", "revision": 1,
    "field": "observations", "quote": "正式记录中的逐字原文"
  }],
  "supersedes_id": null
}
```

scores须恰好10个key，分数为对应题目允许的严格整数；布尔值、浮点数、漏项、额外题目及擅自提交total_score均拒绝。总分由程序相加，不能由客户端/AI决定。assessed_at不能在未来；review_due_at须晚于观察时间和当前时间，均带时区。示例时间只是格式示意，实际须填写真实观察时间和下一次复评期限。

evidence为1–5条同老人、当前有效版本的正式记录，field为raw_text或observations，quote必须逐字出现；更正后的记录只可引用当前observations。保存所引原文和版本，不保证这些引用本身足以证明每道题的计分，仍须评估者及主管逐项核实。

老人须active/out；新建pending老人先按第6项办理入住。建议旧在院资料先补登记再评估。评估保存当时admission_id；办理新的入住或从旧资料补出正式入住单后，原评估不跨入住周期继续生效，需要重新核对。

返回含id/status=draft/revision=1、total_score、template_snapshot、evidence、admission_id、created_by/created_at、events及current。`current.effective`是当下可作为计划依据的状态，草稿恒为false。

确认POST `/assessments/{id}/review`：

```json
{
  "expected_revision": 1,
  "action": "confirm",
  "reason": "人工复核本次观察及机构规范",
  "care_level_label": "机构内部照护档A（人工确认）",
  "care_level_basis": "按本机构演示规则和个体需求人工确定，不作为收费或补贴认定"
}
```

confirm必须显式填写care_level_label/care_level_basis；reject/retire只能填expected_revision/action/reason。主管可确认自己填写的评估，但仍须明确点击确认；此处没有承诺双人独立评估资质。confirm/reject仅作用于draft；retire仅作用于confirmed。每次增加revision并留events。

确认后不支持原地改分数或覆盖来源。复评重新POST完整资料，supersedes_id填本次入住当前评估ID，再审核；新版本确认前旧版本继续按有效期使用，确认成功才把前版标为superseded并保留原分数/证据。相同老人、同一入住不能同时确认两份无关联的评估，避免绕过旧版替代关系。来源变化、复评到期、停用或入住改变会使当前评估失效，但不会篡改历史分数。

## 二、照护计划与版本审批

POST `/care-plans`：

```json
{
  "elder_id": "E1",
  "assessment_id": "已确认评估ID",
  "expected_assessment_revision": 2,
  "title": "个性化活动照护计划",
  "goal": "尊重当前意愿，提供适当协助",
  "starts_on": "2026-10-20",
  "ends_on": "2026-10-27",
  "items": [{
    "key": "morning_activity",
    "title": "核对并协助本人参加活动",
    "scene": "activity",
    "instruction": "先询问本人本次意愿，再按当前安排提供帮助",
    "times": ["09:00"],
    "weekdays": [1, 2, 3, 4, 5, 6, 7],
    "every_n_days": 1,
    "window_minutes": 60,
    "condition": null
  }],
  "supersedes_id": null
}
```

必须引用同老人、当前有效的已确认评估及其版本。starts_on/ends_on为中国本地日期，首尾都包含，跨度最多366个日历日。items为1–20项：

| 字段 | 规则 |
|---|---|
| key | 小写字母/数字/下划线/短横线，1–50字符；同版唯一；修订时同一事项保持同一个key |
| scene | bathing/dining/activity/communication/rest/other，用于AI场景筛选 |
| title/instruction | 人工明确服务标题和步骤，不由模型自动编排处方或医嘱 |
| times | 1–6个去重HH:MM，00:00–23:59 |
| weekdays | ISO周一=1至周日=7，去重；默认每天 |
| every_n_days | 1–30，以starts_on为间隔锚点；须同时满足weekday条件 |
| window_minutes | 1–240，默认60，截止时间=计划时间+此时长 |
| condition | 可选先决条件；生成的任务须走原条件核验流程，不能据文本自动判满足 |

新计划为draft，不能生成任务。POST review使用expected_revision/action/reason，action为approve/reject/retire。approve时再查评估、证据、入住及前版；记录approved_by/approved_at及完整assessment_snapshot。retire仅停用active，reject仅驳回draft。

修订用新的POST完整资料，supersedes_id指向当前计划；审批后旧版变superseded，series_id保持同一条计划链，旧快照不覆盖。同一老人同一入住只有一条当前计划，不支持两套无关联的并行计划。系统不能从自由文本判断“改个key其实还是同一事项”，前端应沿用原事项key，主管核实新增事项的真实含义。

本版审批替代立即生效；不能在今天批准一个明天才开始的替代版而静默移除今天的有效计划，会返回cannot_supersede_before_effective_date。尚无定时切换、复杂条件排班或月度节假日规则。首次建立未来计划可以先审批，但未到适用日期不会注入当前AI上下文。

## 三、按日期及实际班次生成待办

POST `/care-plans/{id}/generate`：

```json
{
  "expected_revision": 2,
  "service_date": "2026-10-20",
  "shift_id": "实际班次ID",
  "assigned_to": "该班次内的有效员工ID"
}
```

显式操作一次处理一个中国日历日期，班次必须开放，assigned_to必须有效且在班次成员内。只生成该日期、符合周期、且时间处于`[shift.start_at, shift.end_at)`的事项；跨午夜班次分别为两天调用，不把次日凌晨挂到前一天的service_date。每次最多100条，整批同事务完成；任一校验失败都不保存半批任务。

生成时检查计划/评估当前仍有效，也拒绝生成安排在下次评估期限以后（或恰好到期时刻）的服务。空排期返回空数组，不伪造未执行记录。暂无定时自动生成；由管理人员明确触发。生成历史日期的待办也只代表补建计划清单，不回填执行记录或修改观察时间，不能用它证明过去服务已发生。

响应：plan_id/service_date/created_tasks/existing_task_ids/notice。created_tasks为原CareTask结构，额外含source_plan_id/source_plan_revision/plan_item_key/service_date/scheduled_at/occurrence_key/source_plan_snapshot/replaces_task_id。source_plan_snapshot保留审批时的计划标识、目标、事项、评估版本和确认人。

按`series_id+item_key+service_date+HH:MM`去重，换Idempotency-Key、并发或计划换版仍不会重复生成同一事项。已有completed/cancelled任务也返回其ID，不自动补发。时间/事项key本身改变属于另一排期，旧待办不会因此自动完成或取消，须人工核对和收尾。

生成的任务通过已有任务接口开始、完成、未执行、转交、取消和交班。任务未分类为院内/远程服务，计划时间也不作为自动证明服务发生的依据；执行人应按真实情况登记。计划复核检查与原条件核验互不替代，两者都通过才可开始/完成。

## 四、变更后的旧待办与人工补发

GET `/tasks/{id}/plan-check`返回task_id/task_revision/historical_only/current。current含required/ready/blocked_reasons和所用/当前计划版本。无计划来源的旧普通任务required=false，保持原业务规则。

每次开始/完成计划任务，在同一写事务按执行时刻检查：计划是否仍active且版本一致、评估是否有效且版本未变、证据是否更正、是否到复评期限、是否同一入住。过期返回409 task_plan_requires_review；不自动按旧版执行，也不把旧任务偷偷改成新版。历史任务不因依据变化自动重开，重复读取原已完成结果仍为原记录。

主管需核对后人工取消旧待办。若新版仍保留同series/事项key/日期/时间，可明确补发POST `/care-plans/{当前版}/reissue`：

```json
{
  "expected_revision": 2,
  "previous_task_id": "已人工取消的旧计划任务ID",
  "expected_task_revision": 2,
  "shift_id": "开放的实际班次ID",
  "assigned_to": "班次内有效员工ID",
  "reason": "已核对新计划，取消旧安排后明确补发"
}
```

仅允许补发当前排期下最后一条已cancelled的计划任务，且仍属于同老人、同计划链和当前排期。完成/未完成/执行中的任务不可补发，已补发的旧任务不能再建第二条。补发建立新任务、保留原任务和source_plan_snapshot，以replaces_task_id相连；不复制已失效的条件核验结论，条件须重新配置核对。排期已从新版移除时拒绝补发；应由主管另行确定当前服务安排。

本版没有把计划变更自动纳入已有change_reviews队列；该队列仍只处理任务采用记忆的影响。这里实现的是执行拦截、当前核对查询、规则质检和明确补发，不宣称已经完成计划变更的独立整改复查工单。

## 五、交班、AI与权限连锁

- 交班快照保留source_plan_snapshot及生成时plan_check；计划/评估状态变化或自然到期，即使任务revision没变，也要求草稿刷新。已提交交班快照不改写，跨班仍沿用原任务ID。接收历史信息不等于批准按旧计划执行。
- 上下文AI选择同老人、同场景、当下有效且已审批的计划事项；source_id形如`plan/{id}/v{revision}/{item_key}`，仅发送目标和事项及版本信息，不发送整份评估原始证据。历史计划不能作为本次事实，引用必须逐字匹配输入来源。
- 模型调用在锁外；保存草稿和人工确认前重新取计划/任务状态指纹。调用中停用计划、复评到期或任务依据变化，旧结果拒绝保存/确认，需重新生成或转人工录入。
- 规则质检可提示task_plan_requires_review；AI交班摘要及质检保存前也检查关联任务的计划状态变化。引用校验和有效性不证明AI语义解释正确。
- 护理员不能直接看计划草稿，也不能通过老人/计划/评估时间线绕过权限；评估草稿仅作者和管理人员可看。正式批准版本可按现有工作人员权限查看；尚无逐老人授权或多机构隔离。

## 主要错误码和接入顺序

业务冲突409包括stale_revision、assessment_basis_not_current、assessment_not_effective、assessment_supersession_required、plan_basis_not_current、plan_supersession_required、plan_not_effective_for_generation、assessment_review_due_before_service、task_plan_requires_review、plan_task_already_reissued。输入问题422包括invalid_assessment_scores、invalid_assessment_times、assessment_evidence_elder_mismatch、assessment_evidence_quote_not_found、plan_assessment_elder_mismatch、assignee_not_in_shift；结构校验仍为FastAPI detail数组。403为实际权限不足；404为对象不存在。

前端顺序：读取模板和当前正式记录→人工填评估→主管核对来源并填写机构依据→显示版本和复评期限→人工写计划及周期→主管审批→选择实际日期/班次/负责人生成→待办页显示原计划和当前有效性→失效时主管处理旧任务及必要补发→交班/时间线展示历史。界面应区分计分、人工档位、已审批安排、待办和真实执行结果，不能用同一个“已完成”标记混在一起。

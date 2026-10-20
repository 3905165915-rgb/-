# 老人、员工、床位与入住接口（0.3.6）

清单第6项后端交接稿，供前端协作者确认接入。路径前缀 `/api/v1`，登录方式保持不变。此阶段只改backend/，不包含前端页面、推送或线上发布。继续使用单服务器JSON，schema仍为4；没有新集合，已有v4无需迁移，旧v1/v2/v3仍须按原流程停服迁移。读接口不补写旧数据。

## 权限与入口

| 方法 | 路径 | 权限与作用 |
|---|---|---|
| POST | `/elders` | 管理人员建档，201，初始状态pending |
| PATCH | `/elders/{elder_id}` | 管理人员修改资料，不改身份/床位/在院状态 |
| GET | `/elders/{elder_id}/admissions` | 管理人员查看入住及换床、外出、返院、离院历史 |
| POST | `/elders/{elder_id}/admissions` | 管理人员办理入住或显式补登记，201 |
| GET | `/beds` | 工作人员查看床位及占用；支持status/limit/offset |
| POST | `/beds` | 管理人员新建床位，201 |
| PATCH | `/beds/{bed_id}` | 管理人员改标识/启停，不直接分配老人 |
| POST | `/admissions/{admission_id}/actions` | 管理人员换床、外出、返院、离院 |
| GET | `/staff/directory` | 管理人员查员工目录，含有效/停用状态及revision |
| GET | `/staff/{staff_id}/workload` | 管理人员查停用前需交接的工作 |
| POST | `/staff` | 创建员工账号，201；主管只能建护理员，管理员可建管理人员 |
| PATCH | `/staff/{staff_id}` | 改显示名、角色、启停；主管只能管理护理员或改本人显示名 |
| POST | `/staff/{staff_id}/reset-password` | 管理人员重置可管理账号的密码或本人密码；成功后须重新登录 |

管理人员：admin/supervisor；工作人员另含caregiver；家属不可访问上述接口。`GET /elders`、`GET /elders/{id}`、`GET /staff`保持原路径。原员工lookup仍仅返回id/display_name/role三个字段，便于原班次/负责人下拉继续使用；新增directory也不返回密码、散列、会话版本。

入住历史是管理资料；护理员可读取老人当前状态和床位，但不能读完整入住历史或用时间线绕过权限。主管的老人时间线会关联本人的历次入住事件。

## 老人资料

```json
{
  "name": "虚构演示老人",
  "contact_name": "虚构联系人",
  "contact_phone": "",
  "notes": "仅用于演示"
}
```

POST返回老人对象，新增稳定的`id`、`revision: 1`、`status: pending`、`bed_id: null`、`current_admission_id: null`、`care_state_version: 0`和建立/更新时间。联系人和备注可省略或null。不得提交自选ID、状态、床位、版本等系统字段；重名不等于同一人，不以姓名去重。

PATCH须`expected_revision`、`reason`及至少一个资料字段。允许改name/contact_name/contact_phone/notes；可用null清空联系人/备注，name不可null。资料和每次入住操作均递增老人revision；床位变了仍是原elder_id，正式记录、任务、个性化记忆的身份关系保留。

新状态`pending`表示已建档未入住，前端需增加相应标签，不应把它显示成在院或离院。旧对象缺少revision时按1读取，缺少status仍沿用旧默认active；不会自动把旧老人改成pending。

## 床位及占用

POST正文：`{"room":"305","label":"1号床"}`。同room+label（忽略大小写）不可重复，包括已停用床位。PATCH：`expected_revision`、`reason`和room/label/enabled的任意组合，均不可null。

返回：id/room/label/enabled/revision/status/elder_id/occupant_ids/created_at/updated_at。status为：

| 值 | 含义 |
|---|---|
| available | 可分配，enabled=true且无当前占用 |
| occupied | 老人在院或外出，保留占用 |
| inactive | 停用的空床，不可入住 |
| conflict | 旧资料的关联不一致，不能直接分配或修改 |

占用由老人当前床位、在用入住单和旧床位elder_id共同核对；不是只相信单个occupied标记。同一床位只能有一个当前老人，不能通过PATCH床位/老人资料绕过入住流程，占用床位不能停用。外出保留床位；必须正式离院才释放。空床恢复enabled=true后才可再分配。

兼容旧部署的`{id, room, status: occupied, elder_id}`结构；label缺省按room显示。缺乏可确认占用者、重复占用或互相矛盾的旧链接标为conflict，不静默修复或重新分配。冲突资料须由运维在备份后核对，本阶段没有任意强制修复接口。改床位名称不会改写入住单保存的旧room/label快照。

## 入住、补登记与历史

先GET读取老人revision和可用床位revision，再POST `/elders/{id}/admissions`：

```json
{
  "expected_elder_revision": 1,
  "bed_id": "从床位接口获取",
  "expected_bed_revision": 1,
  "kind": "admit",
  "reason": "已人工核对入住资料"
}
```

`kind: admit`用于pending或discharged老人；重新入住建立新admission_id，保留原elder_id。新入住时间由服务器记录当前时间，不接受回填过去的时间。一个老人只能有一份active/out入住单。

旧active/out老人缺少入住单时，GET历史返回`needs_legacy_registration: true`。由管理人员明确选择`kind: legacy_registration`补登记；有原床位必须沿用，缺少床位时才选择空床。保留原active/out状态；`admitted_at`、首个bed_stay.started_at为null，只填写当前`registered_at`，明确过去的开始时间未知。不能声称已还原旧入住历史。

响应：`{"elder": {...}, "admission": {...}, "bed": {...}}`。入住单包含id/elder_id/bed_id/status/revision/kind/admitted_at/registered_at/discharged_at/created_by、bed_stays、events。bed_stays保存每段床位及起止时间和当时标识快照；events追加人工操作、时间、责任人、原因和前后床位。没有删除或改写已关闭入住单的入口。

GET历史返回：elder_id/elder_revision/status/needs_legacy_registration/admissions，按登记倒序；支持limit默认100、最大200及offset。住院医疗信息、收费、押金、合同签署、长护险结算不包含在此接口。

## 换床、外出、返院和离院

POST `/admissions/{id}/actions`示例：

```json
{
  "expected_revision": 1,
  "expected_elder_revision": 2,
  "action": "transfer",
  "bed_id": "目标空床ID",
  "expected_bed_revision": 1,
  "reason": "已核对本人和机构安排"
}
```

action允许transfer/out/return/discharge；只有transfer可以也必须传bed_id及expected_bed_revision。所有操作都要当前入住单revision、当前老人revision和reason。响应结构同入住。

| 操作 | 前提和连锁变化 |
|---|---|
| transfer | 在院active、目标空床有效；同一事务释放旧床、占新床、关闭旧床位段并追加新段；老人ID/任务/记录不变；外出须先返院 |
| out | 仅active→out；保留床位和当前入住单，不自动完成、取消或复制任务 |
| return | 仅out→active；继续原入住单和床位，不新建老人 |
| discharge | active/out→discharged；先人工处理全部未结束任务，再释放床、关闭床位段和入住单，清空老人当前关联；历史保留 |

离院前所有状态非completed/cancelled的任务（包括not_done）都必须由人处理；接口不自动记完成、不批量取消。已关闭班次任务仍遵循原跨班流程，接收后继续处理。质量核验单和历史交班可在事后继续核对，不随离院自动关闭。没有“强制离院”绕过入口。

待入住/已离院不能新建正式记录、生成AI草稿、首次确认旧草稿、开始或完成任务；历史查询和正式记录更正保留原权限。重复读取已经完成的任务或已确认草稿仍返回原结果，不代表新的执行。外出状态允许沟通记录及人工待办处理；本版没有按任务种类区分“只能院内执行”，前端不能仅凭out状态推断任务已发生。

每次入住/换床/外出/返院/离院递增care_state_version，AI草稿确认前核对当前状态；普通AI生成在保存前也再次核对。离院再入同一床不能复用旧AI草稿。旧草稿缺少状态快照时，一旦发生新生命周期操作就要求重新生成。上下文AI指纹也含当前照护状态；资料变动后不会沿用旧上下文。历史偏好继续按原有效性/来源规则检索，不声称换床就使全部个人习惯失效。

## 员工管理与账号安全

POST示例（密码仅演示占位，实际由管理人员填写）：

```json
{
  "username": "caregiver-demo",
  "display_name": "虚构护理员",
  "role": "caregiver",
  "password": "由管理人员设置12至128字符的密码"
}
```

用户名3–64字符，首位小写字母/数字，其后可小写字母/数字/`_.-`；与所有旧账号忽略大小写比较，已停用账号的用户名也不可复用。不支持修改用户名或硬删除账号，历史作者ID保留。密码只保存加盐散列，不放入返回、审计或幂等缓存。涉及员工请求的422校验错误剔除原始输入，避免把密码回显到客户端。

PATCH须expected_revision/reason，可改display_name/role/active，均不可null。主管可创建/修改/重置护理员，不能创建或提权为admin/supervisor、不能管理其他管理人员；管理员可管理工作人员。本人可以改显示名/重置密码，不能停用自己或改变自己角色；保留至少一个有效管理员。家属账号不通过此组接口改造成工作人员。

停用前GET workload，返回task_ids/condition_task_ids/review_ids/open_shift_ids及安全staff视图。前三类有未结束责任时拒绝停用，须先走原任务转交、条件重新配置、核验单指派流程。open_shift_ids仅提醒，不阻止停用；不抹除历史班次成员，也不自动补上替班人，管理人员需另行安排。已完成/取消任务的历史责任不阻止停用。

重置密码正文为expected_revision/reason/password，成功递增revision和内部会话版本。实际角色/启停变化也递增内部会话版本。下一次请求会检查JWT的tv与账号版本；停用后再启用、角色改回原值也不能恢复旧令牌。旧账号/旧JWT缺失会话版本按0兼容，登录返回字段不变。此机制控制后续请求，不等同远程清理客户端缓存，也没有新增手机找回密码、强制首次改密、多因素登录或完整账号审计查询界面。

员工新增/更新/重置密码不使用Idempotency-Key缓存：创建重复返回username_taken；修改/重置重复使用旧revision返回stale_revision。客户端丢失响应后重新读取目录/当前revision并核对，不盲目覆盖重试。

## 并发、错误与联调顺序

老人资料/床位/入住命令支持Idempotency-Key，同操作者同动作同key同正文返回原操作快照，不重复建立历史；同key不同正文409。重放响应可能不是当前状态，前端应另GET刷新。权限检查位于重放之前。员工凭据操作除外，见上文。

占用校验、老人状态、入住单、床位段、审计及幂等结果在同一次文件锁事务写入，任一步出错均不落盘；两个请求抢同一床位最多一个成功。revision不一致或占用变化409后须重新读取并人工核对，不能换个key盲目重试。

主要错误码（均为409，特别注明除外）：

| 错误 | 含义/处理 |
|---|---|
| stale_revision | 所读版本过旧，刷新对象 |
| bed_occupied / bed_inactive | 另选可用床位 |
| bed_relation_inconsistent / admission_relation_inconsistent | 关联矛盾，停下并核查备份资料 |
| occupied_bed_cannot_disable | 先依法办理换床/离院 |
| duplicate_room_bed_label | 同房床位标识已存在 |
| elder_already_admitted | 不重复办理在用入住单 |
| existing_in_care_elder_requires_legacy_registration | 旧在院资料需明确补登记 |
| legacy_registration_must_keep_existing_bed | 补登记不兼作换床 |
| return_before_bed_transfer | 外出先返院 |
| resolve_outstanding_tasks_before_discharge | 人工完成/取消剩余任务 |
| elder_not_in_care | 当前不处于active/out，不能新增照护执行 |
| draft_elder_state_changed / assistant_context_changed | 重新生成、核对AI草稿 |
| reassign_staff_work_before_disabling | 先交接员工责任 |
| username_taken | 不能复用已存在账号名 |
| admin_required_to_manage_management_staff（403） | 普通主管不能管理管理账号 |
| cannot_change_own_role_or_active_state（403） | 避免本人锁死账号或自我改权 |

联调顺序：显示pending/新revision字段→建立空床和待入住档案→办理入住→换床/外出/返院→在待办页人工收尾后离院→历史查看与再次入住→员工目录/责任交接/停用与重新登录→验证旧AI草稿被拒。每一步刷新老人、床位和入住单，不能只改前端本地状态。此文是待协作者确认的接口交接稿，不能视为前端或线上验收结果。

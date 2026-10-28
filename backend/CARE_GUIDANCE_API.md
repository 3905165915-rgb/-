# 日常提示与本次照护提醒

2026-10-28。实现基于服务器当前运行的 FastAPI + 带文件锁的 JSON 存储。新内容独立保存在 `care_guidance`、`care_guidance_plans`，不写入任务或长期偏好。

## 接口

所有接口位于 `/api/v1`，使用现有 Bearer 登录。新类型的所有写接口必须携带 `Idempotency-Key`。当前账号角色、老人照护范围和入住状态均在事务中重新检查。

- `GET /elders/{id}/care-advice`、`GET /elders/{id}/arrangement` 声明 `supported_content_types: [routine_hint, one_off_reminder, followup_task]`。
- `POST /elders/{id}/care-advice/{advice_id}/adopt` 保留版本、引用来源、有效期与采用条件检查。日常提示传 `content_type/title/scene/instruction/condition/reason/expected_revision`；本次提醒传 `content_type/title/occasion/service_date/record_what/condition/reason/expected_revision`。混入任务字段返回422。回执为 `status=adopted` 的建议与关联 `guidance`，不关联任务。
- `POST /elders/{id}/arrangement/preview`、`confirm`：主管可独立安排提示，无需评估、班次、人员或任务截止时间。日常提示传 `title/goal/content_type/items`；本次提醒另传 `service_date`。每个 item 包含对应类型字段。预览不写盘，令牌绑定账号、老人、当前入住、内容和上下文版本。确认返回 `plan/guidance/created_tasks:[]`。变更上下文需重新预览。
- `GET /elders/{id}/care-guidance` 返回 `{elder_id,items}`。主管可管理当前入住下的所有状态；护理员仅获得授权老人的已启用提示和当日有效提醒。家属禁止访问。
- `POST /elders/{id}/care-guidance/{guidance_id}/status` 传 `expected_revision/status/reason`。日常提示使用 `pending/enabled/needs_adjustment/disabled`；主管可切换状态，护理员仅能将 `enabled` 报告为 `needs_adjustment`。主管可将有效本次提醒取消为 `cancelled`。
- `POST /elders/{id}/care-guidance/{guidance_id}/record` 传 `expected_revision/response/observation/happened_at`。`response` 为 `willing/alternative/rest/declined/unclear`，均可正常登记。仅当日 active 提醒可登记，时间必须带时区且属于服务日期、不晚于当前时间。原子保存正式记录、关联提醒、更新为 recorded、写审计和幂等回执；不进入自动偏好/任务整理队列。

日常提示由主管直接安排/采用时为 enabled；护理员采用时为 pending，等待主管确认。本次提醒为 active，服务日期按北京时间解释；过去日期不能新建，未来提醒到当日才向护理员展示。到期查询即显示 expired，后台工作循环持久化到期状态及审计。停用、取消、已记录或过期内容不继续出现在护理员提示中。

提示的状态变更与记录更新版本；陈旧版本返回409。相同幂等键和内容重试返回原回执，不重复建提示、记录、计划或任务。换内容复用键返回409。跨老人或新入住访问旧提示返回404，越权返回403。

## 兼容与迁移

- 原跟进任务接口保留。兼容旧请求缺少 `content_type`，也接受新前端明确传 `followup_task` 的安排及事项；写入计划前去除传输类型字段。
- 任务查询、看板、交班与完成率继续读取原任务集合，两类提示不进入该集合。原任务 ID、历史记录、账号、授权与幂等键均保留。
- JSON schema 9 → 10 仅新增两个空集合。显式迁移前保留原文件及附件备份，不自动转换历史任务或偏好。
- 部署须先停止服务，在原存储锁下迁移，再启动新代码。回退代码前需确认兼容 schema10，或在服务停止且确认无新业务写入的情况下恢复配套旧备份；不要用旧 schema9 代码直接读取新存储。

## 验证

`PYTHONPATH=backend python -m pytest backend/tests/test_care_guidance.py backend/tests/test_care_advice.py backend/tests/test_arrangements.py -q`

新增测试覆盖独立保存及重启读取、只读预览、类型字段隔离、令牌失效、状态权限、老人/入住隔离、各种本人回应、日期和到期、并发及幂等、磁盘失败回滚、旧任务请求兼容、任务统计隔离、保留业务数据的备份迁移。

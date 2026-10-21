# 运营核对与变更预览（0.4.1）

新增接口不改已有请求格式，继续单服务器 JSON schema 4，不增加数据库或存储集合。人工核对和个人已读状态追加至 audit_logs。

所有接口仅管理员或主管调用；护理员可通过 `/staff` 查询用于转交的最小有效工作人员目录，详细账号目录 `/staff/directory` 仍由管理人员访问。

| 接口 | 含义 |
|---|---|
| GET /api/v1/insights/coverage?elder_id=...&service_date=YYYY-MM-DD | 当前有效计划发生项、同日已生成任务、补发链尾、已登记完成结果，以及正式记录到任务的来源关系 |
| POST /api/v1/insights/coverage/reviews | elder_id、service_date、occurrence_key、expected_fingerprint、decision、note；decision 为 needs_followup / not_applicable / reopen_review |
| GET /api/v1/insights/changes | since 为带时区时间，可选 elder_id；limit/offset 分页事件。重要未完成任务单独返回，不受已读影响 |
| POST /api/v1/insights/changes/acknowledge | event_ids（1–200）；只标记当前账号已读，重复确认去重，不执行任务 |
| GET /api/v1/care-plans/{plan_id}/impact | 前后项目及计划适用范围、同计划系列未来未结束任务、相关班次及保持原快照的已完成任务；只读，不自动改写任务 |

coverage_status：covered 表示当前任务有 completed 状态和非空结果；partial 表示部分有据；missing_record 表示缺少完成记录；not_applicable 来自当前资料指纹下的人工说明。来源记录只证明建任务依据，不能充当完成证明。缺记录不等于未服务，也不由程序判定医学结果。

核对资料发生变化后，旧人工说明保留为历史并标记非当前；旧指纹提交返回 409。变化简报的已读确认是个人状态，不隐藏遗留任务。统计与计划预览不会调用大模型。

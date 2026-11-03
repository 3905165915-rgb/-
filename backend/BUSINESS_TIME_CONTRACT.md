# 业务日期与时间

机构时区为 Asia/Shanghai（UTC+08:00）。当前照护业务使用北京时间日历；设备所在时区不改变服务日期。服务器登记时刻使用带时区的 UTC ISO 8601，发生时刻保留为另一字段。

| 字段组 | 传输与校验 | 日期/边界处理 |
| --- | --- | --- |
| 班次 start_at/end_at | schemas/api.py 的 AwareTime，start < end | 服务时间 start <= t < end，班次显示用北京时间，可跨日期 |
| 任务 due_at、scheduled_at、条件 check_due_at/valid_until | AwareTime/AwareDatetime | 执行、期限和班次覆盖由 task_service/task_condition_service 校验 |
| 记录 happened_at、事件 occurred_at | 带时区时间；登记时间由服务器生成 | 发生时间不能冒充登记时间，不接受未来事实 |
| 评估 assessed_at/review_due_at | AwareDatetime | 人工评估有效期和任务服务时刻共同校验 |
| 计划 starts_on/ends_on、service_date、items.times | ISO日期、当地时分 | plan_service.occurrences 按北京时间生成；计划起止日均包含 |
| 照护分配 start_at/end_at | AwareDatetime | 生效 start <= now < end；到期后不可继续撤销 |
| 记忆 valid_from/expires_at/review_due_at | AwareTime | 以绝对时刻判断生效、过期和待复核 |
| 日常提示 service_date、回应 happened_at | 日期与带时区时间分开 | 按北京时间日期匹配，不把设备本地日期当服务日 |
| 家属授权 expires_at、简报 period_start/period_end | AwareDatetime | 授权须当前有效；简报开始 < 结束 <= now，左闭右开 |
| 报表/看板 start/end | YYYY-MM-DD | 北京时间零点，start包含、end不包含；上一周期紧邻且等长 |
| 时间线 start/end、recorded_at/happened_at | 查询时间须带时区 | 按服务器 recorded_at 排序和筛选；发生时间单列 |

前端将用户选定的北京时间转换为带 +08:00 的 ISO 字符串后提交。日期字段直接提交 YYYY-MM-DD；不要把日历日期先转成 UTC 再截日期。读取带 Z、+00:00 或其他偏移的时间时，统一转到 Asia/Shanghai 展示。同一时刻无需保持相同字符串，但往返解析后时间戳必须一致。

当前服务日期不使用设备时区的夏令时规则。若机构将来配置其他地区，需另行扩展机构时区配置、历史时区规则和夏令时歧义选择；本次不把固定北京时间转换改成按客户端时区计算。

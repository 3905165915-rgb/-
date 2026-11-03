# 产品改进接口交接

以下路径统一加 /api/v1。新增字段兼容旧客户端；部署前由前后端对照确认。此文件对应 PRODUCT_CHECKLIST_2026-11-02.md。

| 场景 | 接口 | 前端接入方式 |
| --- | --- | --- |
| 本岗位工作收件箱 | GET /work-inbox | queue=mine/review/waiting/processed，elder_id可选，limit默认100最大200，offset从0开始。counts是授权后全部业务队列计数，total是本次筛选后的总数。一个业务对象一行，related_contexts保留各子事项定位。 |
| 老人工作区 | GET /elders/{elder_id}/workspace | 同一快照返回current_admission、tasks/my_tasks、plans、recent_records（最多10条）/record_total、understanding和followups。无有效入住展示context_notice；历史资料不充当本次安排。 |
| 护理工作台 | GET /elders/worklist/me | my_tasks为本人责任，open_tasks保留同班可见事项；current_shift_task_ids可用于首屏，不能隐藏其他未结责任。current_shifts含易读班次标签。 |
| 选择器 | GET /options/{elders/staff/shifts/incidents} | q最长100字，status可选，limit默认50最大200，offset从0开始。staff可按shift_id筛班次成员，incidents可按elder_id筛选；同一快照先权限/筛选再分页。原始ID用于提交，label用于展示。 |
| 计划生成预览 | POST /care-plans/{plan_id}/generate-preview | 与原generate同请求：expected_revision、service_date、shift_id、assigned_to。items为将新建任务，不带临时ID；existing_task_ids为所选班次已生成任务，retained_task_ids为其他班次已安排的原任务；unassigned_items含原因。预览不保存任务或自动化授权。 |
| 实际生成 | POST /care-plans/{plan_id}/generate | 仍需人工确认、当前版本和Idempotency-Key；不得把预览当生成成功。计划自动排期仍需既有授权。 |
| 时间线分页 | GET /items/{item_id}/timeline?envelope=true | 新封装含items/total/has_more/groups/unverified_total/timezone，支持重复event_type及带时区start/end。省略envelope保留旧数组。 |

任务、事件和跟进中的 workflow 包含state_label、primary_action、secondary_actions、responsibility、blocked_reason。主动作描述可用于打开对应办理表单；带POST的动作必须在用户核对必要字段并明确提交后调用。path为API路径，不是客户端路由；客户端应按业务类型进入自己的页面。

事件增加display_label、description_missing、elder_name、state_label、severity_label；description完整保留。较长标题可截断并展开全文。闭环顺序、原证据和独立复查规则继续由服务器校验。通知已读不会完成事件。

新增选项和收件箱的empty_state为null或{code,message}，code=no_matches/page_out_of_range。任务state_label、班次display_label和事件严重程度均可直接显示；ID不作默认主标题。

时间格式及边界详见 BUSINESS_TIME_CONTRACT.md。日期原样传YYYY-MM-DD，时刻传带偏移的ISO值，所有业务展示转到Asia/Shanghai。发生时间与登记时间分开。时间线recorded_at=null的节点归待核实，不用当前时间补齐。

错误保留detail，同时返回error_code、safe_message、field_paths、field_errors、retryable、conflict_type、reload_resource。字段路径以body/query/header/path开头。409先读取reload_resource（路径存在时），保留输入并让用户重新核对；不要自动重放写入。429/502/503/504的retryable允许用户稍后重试，写入须沿用同一次Idempotency-Key并先检查已保存结果。错误目录见ERROR_CODES.md。

## 家属简报四步流程

1. GET /family/summaries/workspace?elder_id=...，可传带时区period_start/period_end及limit/offset。默认今天截至现在；返回本次入住记录候选、可选状态/原因、可公开片段建议、实际有效授权家属名单及数量。记录内容仅供管理人员核对；选项不会直接发布。无当前入住返回context_notice和空候选。
2. POST /family/summaries/preview-selection：{elder_id,period_start,period_end,selections:[{record_id,public_quote?}],text?,public_quotes_confirmed:true}。用户明确选择1-10条记录并核对公开片段；public_quote不传时使用候选首个观察片段。系统填入当前入住、来源版本和字段。text为空则用已核对片段组成预览，合计不得超过2000字符。
3. 预览返回family_preview（只含家属实际将看到的正文和时段）、context_token、recipients、recipient_count、can_publish；evidence_context为管理端展开核对或调用旧可选AI整理接口所用。修改正文后重新预览。AI不可用时继续人工编写。
4. POST /family/summaries/from-selection：同上并传最终必填text和expected_context_token，建议Idempotency-Key。token锁定当前来源版本、入住、时段和最后预览正文；返回真实draft，不等于已发布。编辑和发布/撤回继续用原PATCH /family/summaries/{id}和POST .../{id}/review，保留版本、幂等及审计。无有效授权时可保存草稿，发布返回summary_no_authorized_recipients；授权处理后重新核对发布。无需第二人强制审核。

发布目标始终是老人本次入住下全部当前有效且有summary权限的家属，不指定单一接收人，不代表微信/短信/邮件送达。照片沿用独立审核和共享入口。来源更正、撤回及授权失效后的读取继续由既有公开投影实时判断。

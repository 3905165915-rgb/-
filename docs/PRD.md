# Elder Care Workflow Requirements

## Record and Understand

Staff select an elder, enter or dictate the visit, optionally attach a private reviewed photo, and save once. The formal record is persisted before AI analysis. The same page presents observations, personal-impression candidates and follow-up suggestions for one submitter review. Analysis failure leaves the saved record available for retry by its original ID.

Personal impressions become effective only after human confirmation. Frequency wording and the number of supporting days are informational, never barriers to adding an impression. Staff do not choose between long-term and temporary categories in this workflow. Summaries retain explicit time, negation and conditions; source evidence, versions and review history remain available. The default understanding view shows concise personal traits instead of quoted narratives; original words appear in expandable evidence verification. A missing observation is never treated as proof that the elder can act independently.

## Handover

Caregivers prepare one editable handover summary in the active handover page. Existing unfinished tasks carry their original IDs into the incoming shift. AI-extracted tasks require one submitter review and complete elder, shift, assignee, due time, and completion criteria before creation. Incomplete suggestions remain uncreated.

Managers and supervisors may inspect handover details. Caregivers see only authorized summaries and tasks. Family members see only reviewed public summaries allowed by their current binding.

## Timeline

The elder timeline groups and sorts events by server registration time. Actual occurrence time is a separate optional value. Filtering and pagination must use registration time, including for backfilled events.

## Safety

Server-side role, elder, admission, revision, and source checks are mandatory. Keep an audit trail for confirmations and task creation. Production migrations must back up the existing store first and preserve accounts and business data.

## Safety incident reporting and direct follow-up

Caregivers and nurses report known facts and immediate measures directly. Administrators and supervisors open urgent notifications to inspect the incident, then choose triage, rectification or review from the incident details. Emergency guidance instructs staff to contact on-site personnel and follow institutional emergency procedures first.

Management sees a persistent red urgent-notification banner with a count and a direct incident link. It refreshes every 30 seconds while the page is visible and on focus. Active incident cards appear ahead of ordinary notifications. Reading a notice keeps the emergency pending until the responsible business step is processed.

Selecting a coverage occurrence opens its review form with the elder, service date, occurrence and fingerprint preserved. The page displays the selected context and asks only for a decision and note. A return action reloads the coverage results for the same elder and date. Selecting a result does not submit a business mutation; writes retain explicit confirmation and concurrency checks.

## 2026-10-28 完整改进清单的后端交付

以老人及当前照护事项为工作上下文，保持记录—理解—安排—执行—交班—检查的原有链路。本次只修改后端及契约，前端导航、折叠、样式、恢复日志与移动端交互需由前端接入验收；不能把接口已完成描述为页面已改好。

- 主管可跨浏览器查询完整照护分配及其有效状态，查看撤销影响。撤销范围不删除已发生记录，也不擅自取消明确的任务责任。
- 列表总数先授权、再筛选、最后分页；记录以登记时刻稳定排序。业务跟进、未读消息和紧急消息分别计数，不混成一项统计；查看或已读不等于办理完成。
- 新客户端以background:true一次保存记录，立即得到持久作业状态。模型在文件锁外运行，回写重新检查来源/入住/权限/版本；失败可在原记录重试。旧客户端同步模式继续兼容。
- 检查策略由服务端配置，不要求用户操作AI开关。模型失败仍有规则结果，明确部分完成；无资料不等于无问题；旧来源不能直接核对确认。今日检查和质检台复用同一能力。
- 个人特性默认展示总结，原文留在证据中。精确重复合并展示，语义相似只作分组；已拒绝且没有新证据、已确认且未变化的内容不重复打扰。归档完全重复的待确认信息须主管预览确认，全部来源及版本保留。
- 不要求用户选择长期/临时分类，但“今天不想散步”保留日期且不能覆盖通常喜欢散步的记忆。明确日期的意愿自动提供适用时间；未明确的临时意愿需人工确认结束时间。单次任务不冒充个人特性，专业照护仍需单独权限和评估。
- 批量仅提供主管转交简单任务及工作人员标本人消息已读，逐项返回真实成功/失败。条件、计划和建议关联任务需单独办理，不能用批量绕过专业复核。
- 护士与护理员按当前工作范围授权，管理人员分级/安排整改/独立复查，家属仅看已审核共享内容。演示全老人家属选择仍受服务器环境开关控制。
- 运行日志区分模型、模板、来源版本、耗时及安全失败码；保存人工采纳/拒绝/修改。人工标注独立评测用于漏提、误提、时间和证据错误，运行采纳率不作为模型准确率。

继续使用schema 9和JSON原子持久化；本次不修改线上配置、不部署、不重建或删除王爷爷样本。实际后端测试和39项映射见backend/IMPROVEMENTS_2026-10-28.md。

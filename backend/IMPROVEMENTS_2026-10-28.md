# 完整改进清单：后端实施与逐项验收

依据：2026-10-28《前后端完整改进分工与验收清单》，28 页，39 项。
本轮仅改后端及共享接口文档，不修改前端，不部署、不清除现有资料。用户已授权最终上传仓库。

## 基线与解释

- 起点：`release/verified-20261027-backend`，`fa30358`。保护现有 31 个已修改文件及护士/事件专项测试。
- 沿用 FastAPI、schema 9、服务器 JSON 原子写入，不引入数据库。
- 开始前完整阅读清单、AGENTS、PRD、API 与相关服务。758 passed、15 skipped（真实云模型需单独启用）。
- 前端专属的导航、液态玻璃、响应式、草稿恢复不在后端伪造“完成”；后端交付其数据、状态、授权与兼容契约。
- 已有完整安排、交班、事件分阶段、来源更正、条件任务及共享授权不重复建设，保留并回归。

## 依赖顺序与证据

| 分组 | 对应清单 | 交付内容 | 验收状态 |
|---|---|---|---|
| A | 04、11、14、22、31 | 分配全量查询/详情/影响预览、统一上下文和分页 | 后端已实现并通过回归 |
| B | 16、26、27、32 | 保存与后台作业分离、状态与结果核实 | 后端已实现并通过回归 |
| C | 20、26、27 | 质检自动策略、部分失败、去重、来源复核 | 后端已实现并通过回归 |
| D | 23、24、25、28 | 候选分组去重、证据与人工修改统计 | 后端已实现并通过回归 |
| E | 01、02、12、13、17、33 | 待办分页同口径、统计与低风险批量 | 后端已实现并通过回归 |
| F | 05、06、07、18、19、21、29、30、34、39 | 时间/中文错误、共享范围、流程回归与权限 | 后端已实现或沿用并通过回归 |
| G | 全部后端相关条目 | 全量回归、真实 HTTP、OpenAPI、变更记录与上传 | 自动回归及HTTP通过；真实云调用未验收，推送结果见交付回执 |

每组完成后记录实际命令、数量和结果；失败先修复，不以接口 200 代替业务验收。不得把跳过的真实模型验证写作通过。

## 本轮修复与行为变化

1. 照护分配增加持久列表、详情、有效状态及撤销影响；不依赖创建它的浏览器。撤销仍保留历史及任务责任。
2. tasks/records/drafts/quality可选择分页封装，旧数组模式不变；跟进和消息统计分开，计数在分页前按实际权限计算。
3. 记录作业回执增加saved及job细节。已有后台保存/恢复逻辑继续复用，模型不占长写锁，按原记录重试。
4. 质检使用服务端AI策略；规则成功、模型失败时保留部分报告。修复模型finding循环覆盖幂等key的错误；写事务重查幂等回执，防并发重复报告。来源变化不能直接确认旧问题。
5. 今日检查去掉外层长写事务，复用同一质检策略，各单项失败互不抹掉结果。大范围模型输入也不丢规则结果。
6. 偏好精确分组保留否定、时间、场景、表达者及独立证据；相似度只作提示。相同证据的已拒绝候选不反复打扰，来源更新可再核实；已确认未变的特性留存证据但不进入新增审核。
7. 主管可预览并归档完全相同来源/时间/版本的待确认重复信息；保留项仍需确认，未删除任何记录。不同来源、有效记忆或专业项不得批量合并。
8. 明确日期的临时意愿保留当天适用时间；未明确日期的“暂时/本次”需确认结束时间，不能无限期成为偏好。不要求工作人员手动选长期/临时类别。
9. 增加主管批量转交简单任务、本人消息批量已读。逐项隔离授权/版本/状态，失败不影响成功项；条件/计划/建议任务单独核对，禁止批量完成或关闭。
10. 修复跟进列表按混用时区字符串排序及空截止时间报错；今晚/明晚等以记录实际发生时间在北京时间解析。
11. 工作列表增加中文床位/人员/班次显示上下文，简化面向工作人员的说明；HTTP错误补中文安全信息，保留旧detail兼容。
12. 增加护士角色在原有照护链路的授权和管理隔离；安全事件由护理员/护士按事实直接上报，主管分级及独立复查，紧急消息优先于普通消息分页。
13. 记录个人印象人工采纳、拒绝和修改；运行日志覆盖个人特性总结、来源版本与安全失败码。人工gold独立评测继续用于误提/漏提/引用错误，统计不冒称准确率。

## 39项逐项对照

“后端通过”指对应服务器能力的自动测试及适用HTTP检查；不代表前端页面或线上环境已验收。“前端专属”条目本次未改，保留给前端负责人员，不把它们计作界面已完成。

| 项 | 最终后端效果/实现位置 | 验收证据或边界 |
|---|---|---|
| 01 业务待办与消息 | followup_service按实际事项聚合；notification_service读消息不关闭业务 | test_followups、test_notifications、test_improvement_workflows |
| 02 总数/筛选/分页 | listing_service统一封装，授权/筛选在计数前，同快照取页 | test_improvement_workflows分页、角色隔离及同来源去重 |
| 03 安全字段/证据 | incident_service保留可选证据，无正式记录也可报告 | test_incidents、test_safety_roles |
| 04 历史照护分配 | care_scope_service列表/详情/状态/撤销影响 | test_improvement_assignments跨会话、过期、旧版本 |
| 05 机构时区 | time_proposal及计划排期使用Asia/Shanghai，按发生时间定位自然语言日期 | test_simplified_time、test_improvement_workflows今晚/明晚 |
| 06 加载/空态/失败 | 记录saved/job、quality.has_sources/partial、中文错误 | test_background_records、test_improvement_workflows；加载组件由前端处理 |
| 07 技术字段/英文 | display context返回名称，main补中文safe_message，保留内部ID关联 | test_presentation_context、test_improvement_workflows；界面隐藏技术码待前端 |
| 08 统一名称 | 接口保持兼容，不为重命名复制业务 | 前端专属：菜单/标题本次未改 |
| 09 导航精简 | 提供稳定对象关联/allowed_actions | 前端专属：六入口、路由本次未改 |
| 10 设置/工具归位 | 沿用明确授权的设置/整理/评测接口 | 前端专属：导航归位本次未改 |
| 11 老人班次上下文 | worklist及任务展示上下文，服务端验证来源与班次 | test_care_scope、test_presentation_context、test_safety_roles |
| 12 今日优先事项 | worklist真实当前任务，风险跟进和紧急消息优先分页 | test_dashboard、test_followups、test_safety_roles |
| 13 真实图表 | 沿用dashboard/report同快照计算及详情一致性 | test_dashboard、test_reports；图表交互本次未改 |
| 14 老人/缺资料 | 中文床位、入住关联、缺失不猜测历史床位 | test_facility、test_presentation_context |
| 15 老人主入口 | 同老人路径复用记录/understanding/arrangement接口 | 前端专属：页签及入口布局本次未改 |
| 16 一次保存 | background:true原子保存入队，job持久状态，原ID重试 | test_background_records、test_improvement_workflows |
| 17 新建任务 | 沿用create/transition/complete，完整字段及来源校验 | test_task_creation、test_tasks；表单优先级由前端改 |
| 18 安排单卡 | preview无副作用，confirm保护旧任务/人工调整 | test_arrangements、test_review_before_plans |
| 19 单页交接班 | 原任务ID接续，摘要/待接收/澄清/接收权限保留 | test_handovers、test_public_summary；页面整合由前端改 |
| 20 一键检查 | quality策略/partial/幂等/源版本，today复用 | test_ai_quality、test_improvement_workflows |
| 21 事件分阶段 | 上报→主管分级→整改→独立复查，权限逐阶段校验 | test_incidents、test_safety_roles、test_emergency_incident |
| 22 有效评估 | 当前有效与待复评分开，不以缺失推测评分 | test_planning、test_elder_workspace |
| 23 简洁个人特性 | display_summary、缓存总结、证据单独保留 | test_public_summary、test_elder_workspace |
| 24 去重/新变化 | candidate_service精确组/相似提示/拒绝抑制/未变隐藏/主管重复归档 | test_improvement_workflows，保留来源及历史 |
| 25 分类/时间 | category兼容保留；applicability及可选expires_at，临时意愿不永久化 | test_improvement_workflows临时意愿，test_memories |
| 26 建议到动作 | 质检related_items、跟进action_path、作业result_ref | test_followups、test_improvement_workflows；前端需接入跳转 |
| 27 保存/处理分开 | saved/analysis_status/job，规则与模型分别反馈 | test_background_records、test_improvement_workflows |
| 28 效果/独立评测 | governance运行版本/耗时/安全失败/人工修改，gold共同样本评测 | test_governance、test_evaluation、test_improvement_workflows；真实云调用跳过 |
| 29 双向核对 | coverage/changes保持同老人/日期/来源指纹，变更不自动认定服务发生 | test_insights、test_record_impacts |
| 30 从事项回放 | 沿用timeline及case export实际关联，不扩展无关老人资料 | test_reports、test_family_timeline、test_regression_review |
| 31 默认加载/筛选 | 增分页封装及任务关键词，数组兼容 | test_improvement_workflows；页面自动加载由前端改 |
| 32 草稿/恢复 | 正式草稿列表/版本/确认/后台状态不丢存储 | test_draft_versions、test_background_records；本机恢复日志由前端改 |
| 33 低风险批量 | 批量预览/转交、消息已读，逐项结果，强制幂等键 | test_improvement_workflows旧版本/无权/条件任务/部分失败 |
| 34 危险动作确认 | 原版本、幂等、来源保护不绕过；预览不写 | test_facility、test_arrangements、test_change_reviews；更多菜单由前端改 |
| 35 液态玻璃 | 不涉及服务器业务逻辑 | 前端专属：本次未改样式/动效 |
| 36 视觉组件 | 不复制前端组件到后端 | 前端专属：本次未改令牌/组件 |
| 37 电脑/手机/键盘 | 受控附件/语音接口保留，权限不因页面布局变化而开放 | test_photos、test_speech、test_vision；视口/触屏/键盘本次未验收 |
| 38 成功/空态语义 | has_sources、saved、partial、逐项success、中文safe_message | test_improvement_workflows；组件与焦点本次未改 |
| 39 便捷演示/环境 | 沿用demo-login环境限制、家属演示选择及共享边界 | test_demo_role_login、test_family_demo_access、test_delivery_review |

上述测试名省略backend/tests/前缀及.py后缀，均在本轮完整回归中实际运行。真实云调用用例明确跳过，前端截图和跨设备E2E未在此后端工作区执行。

## 本次实际验收

按分组开发与修复后依次执行：

- A分配/分页初验33项通过；C早期专项20项通过；B/C/D关联专项71项通过；新增工作流初验36项通过。
- 扩大到记录/权限/时间/治理专项时发现跟进空截止时间排序异常：修复前105通过、1失败；修复后相关39项通过。
- 增加已确认未变特性、临时意愿边界等后：102项通过。
- 最终完整命令：

```powershell
$env:PYTHONPATH='backend'
& D:\Python313\python.exe -m pytest backend/tests -q -p no:cacheprovider --basetemp=backend/.test-runs/final-improvements-20261028 --junitxml=backend/.test-runs/final-improvements-20261028.xml
```

结果：**785 passed, 15 skipped, 1 warning，259.62秒**。warning为现有Starlette/httpx测试客户端弃用提示；不影响这次测试结果，未为消除提示而更换依赖。15项skip为需要显式开启和真实凭证的云端调用，不是通过。

实际启动uvicorn并通过127.0.0.1隔离HTTP验证，共16次请求：schema 9健康、OpenAPI的172个路径及新增路由、四角色登录、护士老人范围、分配分页、后台重复保存只一条记录、质检、跟进、家属拒绝内部资料、中文404。保存/读取都在临时目录，启动时关闭后台worker并清空云凭证，进程已停止，未触碰现有演示或线上数据。

本地机器验收证据（被.gitignore排除，不上传用户资料）：

- `backend/.test-runs/final-improvements-20261028.xml`
- `backend/.test-runs/http-improvements-20261028.json`

## 前端接入与交付边界

- 新版页面要显式使用background:true，读取job进度；旧同步调用未被强行切换。
- 质检页面省略include_ai即可用服务端策略；服务器QUALITY_AI_ENABLED默认false，本次未修改线上配置。若演示需默认模型检查，部署人员配置true后单独做真实模型验收。
- 个人特性展示groups与display_summary，证据按需展开；临时意愿按applicability补结束时间，使用expires_at确认。
- 新批量接口使用逐项结果，列表分页需请求envelope=true；不把批量HTTP200当作全部成功。
- 前端导航、自动加载、图表布局、液态玻璃、草稿恢复、响应式、触屏键盘及截图未修改/未验收。不能据后端785项通过宣称这些界面已交付。
- 代码沿用schema 9，新字段为兼容附加；不重建老人、不更改测试账号、不删除记录。无部署、无服务器重启。
- 当前工作副本没有文本/语音/视觉云密钥；只交付模型适配及模拟/故障/权限测试结果，真实模型可用性和效果仍需在已配置凭证环境验收。
- 最终提交包括原有未提交护士/安全事件改动及本次后端改进，目录仅backend和docs。推送前复查远端祖先关系，不强制覆盖他人提交；不推前端分支。

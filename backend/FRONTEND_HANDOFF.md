# 前后端交接（2026-10-21，0.4.2）

用户已授权本轮补齐管理端与手机端并联合部署。后端在 feat/backend 工作区；前端以 origin/feat/frontend@4be5e22 为干净基线，在隔离快照修改，累计补丁 54 个文件（含 release05 入口恢复及 release07 班次/人员目录修复）。没有直接修改协作者工作区、推送或合并。

最新发布见 [RELEASE_2026-10-21.md](RELEASE_2026-10-21.md)。当前后端 0.4.2，前端 291 项测试通过。登录保留稳定 user_id；班次成员匹配不可使用用户名代替。写操作过滤开放/本人班次，交班目标保留其他护理员的开放班次，历史查询不作同样过滤。恢复草稿中的不可用班次须让用户重新选择，不静默替换。护理员人员目录使用 `/staff` 的安全字段；不能因操作 schema 是引用就错误删除所需目录，否则记录确认和任务转交负责人下拉框会为空。

当前功能、验收结果与人工步骤以 [JOINT_TEST_2026-10-20.md](JOINT_TEST_2026-10-20.md) 为准；与两份任务 PDF 的映射及尚未实现项目见 [INTEGRATION_AUDIT_2026-10-20.md](INTEGRATION_AUDIT_2026-10-20.md)。此前“仅预览”的旧说明已过时。

## 搭档如何承接

1. 在包含 4be5e22 的个人前端分支保存自己的改动，检查 `backend/deploy/frontend-api-integration.patch`。这是从基线生成的累计补丁，已包含上次 DTO 和手机身份修复，不要在已应用旧版的目录直接重复应用；先做三方对照合并。
2. 干净基线可先 `git apply --check backend/deploy/frontend-api-integration.patch`，再 `git apply backend/deploy/frontend-api-integration.patch`。本轮已实际应用并逐文件比对，不只是检查 patch 语法。
3. 核心新增为 `packages/shared/src/workflow/`、管理页 WorkflowsPage、三端真实业务入口和移动路由回归。业务表单按 OpenAPI 生成契约，111 个操作，另有 raw WAV 语音、登录和健康接口。
4. 运行两端 vue-tsc、Vitest、ESLint 和正式构建。生产设置 `VITE_APP_MODE=api`、`VITE_API_BASE_URL=/api/v1`；管理端 Vite base=/，手机 base=/mobile/。不能把 localhost 写进生产 JS。
5. 保留两端错误页恢复和入口跳转。管理端 `/403` 对有效会话恢复到各自首页；护理员从根入口进入 `/mobile/`，手机根登录默认进入手机端，`?view=admin` 显式选择管理端。包含管理路由及班次/人员目录回归，当前累计 291 项通过；两端类型检查、生产构建和 ESLint 无错误。

## 必须保留的接口行为

- 使用真实 JWT 和 snake_case。401 清会话并登录；403 不冒充成功；409 刷新当前资料并人工核对；422 显示校验信息；503 保留输入且可人工登记，不静默切 Mock。
- AI 草稿正文与确认接口分开；确认只交 observations/task_candidates。摘要采用、记忆确认和质检处理各有独立人审动作。
- 幂等键放 Idempotency-Key 头，正文不混入 key；同一次失败重试复用，开始新操作清表单。提交中禁重复。
- expected_revision/fingerprint 从当前关联对象获取；选择证据同时使用当前 revision、字段与原文引文，不能伪造。
- 列表全量按页读取；入住历史是 admissions 封装；记忆必须按 elder_id 查询；布尔项空值代表未选，不能默认发 false 停号/停床。
- 跨班绑定真实 shift ID，接班使用 handover_id 和 item_id；老人 ID 不随床位改变。
- 家属仅访问 family/me 授权 API；管理端负责账号、绑定、简报审核和回复。管理员能进手机护理端，不需要撤销家属隔离或独立复查限制。
- 语音接口是 raw audio/wav；客户端转换至 16kHz/mono/PCM16，不要把 webm 或 multipart 直接传给服务端。转写只填原文，不自动建正式记录或任务。
- 新 insights 接口见 [INSIGHTS_API.md](INSIGHTS_API.md)：双向核对、个人已读、计划系列影响均为确定性规则，不冒充大模型预测。

## 部署边界

服务器已运行 0.4.2/schema4，原数据、账号、私有密钥保留。后端发布及 Linux 验收位于 /root/hulaozhijiao-release-20261021-06-retries-shifts；最新前端源包与公网验收存档位于 /root/hulaozhijiao-release-20261021-07-staff-catalog。当前 Nginx 对 HTML 禁用缓存/304，哈希资源仍可缓存；嵌套 location 重复安全响应头以保留响应头继承效果。原 caregiver 公网真实 AI 记录、任务与重试，以及交班 AI 摘要、人审提交和主管逐项接收已通过；浏览器标识模拟不等同真实手机引擎测试。密钥和明文测试账号不在补丁中。GitHub 分支尚未因本轮自动更新，后续提交前检查 Git diff，按用户指示推送。

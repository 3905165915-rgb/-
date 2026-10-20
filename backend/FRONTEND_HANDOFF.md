# 前后端联调差异与接入顺序（2026-10-20）

本次只修改backend/。已git fetch并只读检查origin/feat/frontend，提交9f0cf53（feat(frontend): add admin and mobile app scaffold）；没有擅自合并、推送或修改前端。以下是该提交实际源码差异，不表示部署后的静态文件必然与该提交相同。

## 优先修正的合同差异

| 前端文件/方法 | 现状 | 后端0.4.0需要 |
|---|---|---|
| packages/api-client/src/http.ts：createApiClient | 默认baseURL=/api | 默认或构建环境配置/api/v1；已有正确VITE_API_BASE_URL时以环境为准 |
| index.ts：extractRecord | elder_id类型允许缺省 | elder_id必填，使用GET /elders真实ID，按需要传shift_id；不能用床号代替 |
| index.ts：confirmRecord | 直接接受Partial<RecordDraft> | 正文仅observations/task_candidates，不能把id/provider/raw_text/status等整份草稿发回，否则422 |
| index.ts：completeTask | 把result和idempotencyKey一起放入JSON | JSON仅{result}；随机key只放Idempotency-Key头，额外正文会422 |
| index.ts：handover/receiveHandover | /handover/{shiftId}、/handover/{id}/receive | GET /handovers?shift_id=...；逐条POST /handovers/{handover_id}/items/{item_id}/receive；接班不是全单一键确认 |
| index.ts：familyCases | /family/cases，无kind | 此接口只供主管，kind=binding/summary/feedback必填；家属使用/family/me/bindings及绑定下summaries/feedback |
| http.ts | 全部15秒超时 | 云AI/语音可单独配置更长超时并处理503/超时；手工记录保留；不能把超时当作已保存 |
| 两端LoginPage.vue和router | 可写入demo-token，路由仅判本地session存在 | 明确区分本地演示和真实账号；无有效JWT不得请求真实业务；401退出并保留用户可恢复草稿，不能仅靠前端角色控制权限 |

后端继续执行严格请求校验与权限控制。不会为了让旧前端通过而接受任意草稿字段、绕过家属授权或新增无版本保护的交班兼容入口。

## 推荐联调顺序

1. 登录→真实老人目录/详情→人工记录→AI草稿核对确认→任务执行，先通过一条真实接口链路，页面不再只改localStorage。
2. 班次→交班草稿→刷新/人工提交→逐条澄清/接收→原任务跨班延续；使用实际shift_instance ID。
3. 主管确认记忆→护理员按场景检索→明确采用→来源更正→核验工单→另一人复查；先读MEMORY_API/TASK_MEMORY_API/CHANGE_REVIEW_API。
4. 条件核验、档案/床位/入住、人工评估、审批计划及周期待办，按各专属文档接入。
5. 家属绑定/期限/撤销→主管审核简报→家属读取→反馈→主管回复。家属端不请求内部/elders、/records或/family/cases。
6. 不良事件人工分级→整改责任人提交→另一人复查→统计/内部JSON导出。

## 通用处理

- JSON使用snake_case、时间含时区；403表示不能继续，409先刷新并由人核对，422展示校验错误，503回人工入口。不能把失败请求的本地状态改成成功。
- 对象ID从接口取得；老人ID不随床位变。expected_revision使用当前读取值，幂等key对同一次操作复用，不同正文不可复用。
- 读列表分页，不能只取默认100条就计算机构统计；机构统计用/reports/metrics并展示口径。
- 护理员仅查看被授权的草稿/交班/事件；管理员和家属端也由后端核权。
- 简报来源变动、授权撤销或自然到期后需刷新。禁止在持久localStorage中另存真实老人明细；退出/切换账号清除该账号页面数据。
- 上下文助手与普通extract路径不同；页面必须展示provider、草稿状态、原文证据和人工确认动作。Mock明确标注演示。
- JSON默认导出也是内部材料；只有主管可以显式导出正文，不放在家属下载入口。

## 部署顺序

前端协作者确认接口并提交适配→隔离环境完成两端操作→Linux回归→备份代码/数据→停服迁移schema2到4→更新后端与适配后的前端→健康/权限/人工链路→用合成文本和合成音频另验真实AI/语音→检查回滚。

目前公网只读核实为0.2.1/schema2；本地为0.4.0/schema4。不要把本地已通过测试描述为网站新功能已上线。

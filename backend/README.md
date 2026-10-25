# 护老智交后端

这是参赛演示版后端，使用 FastAPI 和 JSON 文件存储，不使用数据库。JSON 存储适用于单服务器、低并发演示；正式生产部署前应替换为事务数据库并重新进行安全与隐私评估。AI适配层支持 DeepSeek OpenAI兼容接口，当前默认仍为 Mock，配置真实密钥后再切换。

当前本地API版本0.4.3，JSON schema 7。新增主动照护建议闭环，接入见[照护建议接口说明](CARE_ADVICE_API_2026-10-25.md)，本轮结果与范围见[建议闭环验收记录](ACCEPTANCE_CARE_ADVICE_2026-10-25.md)。旧schema 1至6均须停服备份并显式迁移；不要删除数据文件重新初始化。本轮未推送、未部署，新增能力的前端联调另行验收。

此前0.4.2改进清单的逐项实现与验收见[ACCEPTANCE_IMPROVEMENTS_2026-10-25.md](ACCEPTANCE_IMPROVEMENTS_2026-10-25.md)，其他新增接口、权限与前端对接见[IMPROVEMENT_API_2026-10-25.md](IMPROVEMENT_API_2026-10-25.md)。以下历史测试数字均对应各自版本，不能代替本轮结果。

改进清单全量回归603通过、13跳过；独立临时Uvicorn的真实TCP/HTTP验收73项断言通过。其后按用户要求复用DeepSeek账号配置视觉输入，真实视觉接口验收2项通过、相关回归35项通过，见[视觉接入记录](DEEPSEEK_VISION_2026-10-25.md)。测试采用代码绘制的合成图片，不代表真实养老照片或临床识别效果已经验证。

此前任务回顾见[STATUS_REVIEW_2026-10-20.md](STATUS_REVIEW_2026-10-20.md)，家属业务见[FAMILY_API.md](FAMILY_API.md)、事件整改见[INCIDENT_API.md](INCIDENT_API.md)、基础统计见[REPORTS_API.md](REPORTS_API.md)。旧对接说明保留供查阅，变更以本轮改进接口说明为准。

历史版本2026-10-20上传前验收：Linux Python3.10.12完整回归402通过，真实HTTP61个断言通过，显式真实配置验收12通过（11次DeepSeek文本请求、1次云语音请求，另含不联网故障注入）。详细证据、修复和AI局限见[ACCEPTANCE_2026-10-20.md](ACCEPTANCE_2026-10-20.md)。这些数字不是本轮新功能的真实供应商验收结果。

## 本地启动

在仓库根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
python backend/scripts/seed_demo.py
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

健康检查：`http://127.0.0.1:8000/api/v1/health`

演示账号：`admin`、`supervisor`、`caregiver`、`family`，密码均为 `demo123`。仅用于本地演示，不能用于生产环境。

## DeepSeek配置

复制 `.env.example` 后设置：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=不要提交到GitHub
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-flash
AI_FALLBACK_MOCK=false
```

真实API不可用时，接口返回503，前端应保留人工录入入口；不要把AI错误伪装成成功结果。

照片识别也可复用同一DeepSeek账号：在私有配置中填写`VISION_API_KEY`（与文字密钥的实际值相同）、`VISION_BASE_URL=https://api.deepseek.com/v1`、`VISION_MODEL=deepseek-flash`、`VISION_TIMEOUT_SECONDS=45`。Flash视觉请求使用非思考模式与JSON输出，结果仍须人工核对。配置在进程启动时读取；服务器已保存配置，但新视觉接口代码尚未部署，不能仅凭配置保存宣称线上已可识别。

搭档电脑可使用仓库中的加密AI配置：安装`requirements-setup.txt`后运行`python backend/scripts/setup_ai_test.py`，输入单独提供的口令生成私有`.env`。具体步骤见[AI_TEST_SETUP.md](AI_TEST_SETUP.md)；口令与解密后的文件不提交Git。

## 数据安全约束

- `backend/data/` 不提交到Git；使用 `seed_demo.py` 生成虚构数据。
- AI草稿必须人工确认后才会创建正式记录和任务。
- 不把API密钥、真实老人数据、录音或服务器密码提交到仓库。
- 当前服务按单进程设计，写入JSON前使用文件锁和原子替换。

## 已完成的核心链路

- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `GET /api/v1/elders`
- `GET /api/v1/elders/{elder_id}`
- `POST /api/v1/records/extract`
- `POST /api/v1/records/{draft_id}/confirm`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks/{task_id}/complete`

在以上旧接口之外，现已增加手工记录、草稿找回/放弃、正式记录更正留痕、任务分配/期限/流转、跨午夜班次、双向交接/澄清、原任务跨班延续、AI摘要、规则与AI质检、证据时间线。

0.3.0新增个性化照护记忆：正式记录引用、候选提交、主管确认/复核/停用、版本历史、场景与时效过滤；来源记录更正后同步转待复核。具体接入见 [MEMORY_API.md](MEMORY_API.md)。此版提供人工确认与检索基础，尚未自动接入AI提取或注入已有AI请求。

0.3.1继续实现上下文AI记录：按老人/场景/班次选择有效记忆和未完成事项，分开提取本次事实、个性化候选和带引用的历史提醒；生成与确认时复查上下文。正式记录确认后可单独选中AI候选，人工填写期限，再提交主管审核。新接口与接入顺序见 [ASSISTANT_API.md](ASSISTANT_API.md)。有效计划检索已在0.3.7加入。

0.3.2增加任务采用记忆的版本关系：工作人员明确选择后保存当时版本和来源快照，可撤回留痕；专用读取接口检查来源/版本/期限是否变化，不覆盖旧依据、不自动重开已结束任务；交班明细保存采用关系快照。详见 [TASK_MEMORY_API.md](TASK_MEMORY_API.md)。

0.3.3增加变更影响核验队列：来源更正/记忆变更同事务建单，主管扫描补查自然到期；同关系未关闭单去重，指派、处理证据、另一人复查、退回与关闭留痕。定位跨班交班条目并保留历史快照，状态/引用/上下文在提交与关闭时复查。规则队列不调用AI，也不自动执行任务。详见 [CHANGE_REVIEW_API.md](CHANGE_REVIEW_API.md)。尚无自动定时扫描或消息推送。

0.3.4复查修复任务执行遗漏班次校验、时间线绕过交班访问限制、普通AI提取/交班摘要/质检等待期间权限变化后仍保存结果的问题；记忆、任务、交班写入也复查当前账号。请求字段和JSON schema4不变，修复说明见 [REVIEW.md](REVIEW.md)。

0.3.5增加条件待办核验：主管明确标准和责任人，指定人引用正式记录确认满足/未满足，满足结论须有效期；未满足/到期/来源变化阻止原任务开始和完成。跨班保留历史并清空当前结论，接班者明确认领后重新核验。交班、上下文AI、质检检查条件变化，AI不能自动判定或执行。详见 [TASK_CONDITION_API.md](TASK_CONDITION_API.md)。JSON schema仍为4，不需要新增迁移；仅完成后端，未接入家属回复或前端页面。

历史版本请求、响应和权限说明见[API.md](API.md)，历史实现范围见[IMPLEMENTATION.md](IMPLEMENTATION.md)。上述0.3系列条目描述对应版本当时的边界；本轮新增接口以[改进对接说明](IMPROVEMENT_API_2026-10-25.md)为准。前端代码由搭档负责，后端测试通过不代表页面已完成接入。

## 测试

```powershell
$env:PYTHONPATH='backend'
python -m pytest backend/tests -q
```

覆盖事务原子性、并发确认、防重复提交、权限、版本冲突、更正历史、跨午夜交接、引用造假、AI失败、人工审阅不自动改业务以及迁移/恢复。

真实服务验收：`python backend/scripts/verify_local_runtime.py`。自动启动临时Uvicorn、用合成账号通过TCP/HTTP串联业务，随后关闭临时进程；不读取生产数据或使用真实云Key。测试目录为backend/.test-runs/。当前Windows工作区执行pytest可加`-p no:cacheprovider --basetemp=backend/.test-runs/<新目录>`避开根目录缓存权限问题。AI离线评测工具见[evaluation/README.md](evaluation/README.md)。

## 存储迁移和备份

当前schema为7，本轮新增照护建议与生成批次集合，保留既有通知、照护分配、照片引用、视觉分析和AI评估集合。旧schema 1至6启动时不会自动迁移；先停服，加载服务端环境配置后执行：

```sh
python backend/scripts/migrate_json.py
python backend/scripts/backup_json.py
```

迁移前自动保留原文件，不重置账号、密钥、记录或任务编号。人工恢复前必须停服：

```sh
python backend/scripts/backup_json.py --restore /absolute/path/to/backup.json --confirm-service-stopped
```

含照片的备份会生成同名 `.attachments` 文件夹，复制或归档时必须与JSON成对保存。恢复先校验文件和哈希，不能只恢复JSON而丢失原图。

恢复仅支持当前schema，会再次备份现有数据并保留当前账号和密码；同时使旧登录失效、清空旧幂等缓存与通知、撤销恢复快照中的有效家属绑定及照护分配。恢复后须重新登录、核实家属授权并由主管重新安排照护范围，不能沿用旧页面中的版本提交。恢复包含文件操作，必须全程停服。每日备份的systemd服务和timer放在 `deploy/`；安装与验证见[deploy/README.md](deploy/README.md)。备份位于数据目录的backups/，没有自动清理，也不等于异地容灾。

## 免费云端语音识别

设置 `SILICONFLOW_API_KEY` 后使用 `FunAudioLLM/SenseVoiceSmall`，识别计算在厂商侧。独立测试页 `/api/v1/speech/demo`，工作人员登录后可录音并校对/复制文字；不自动保存记录，主前端按钮仍需协作者联调。

上传接口、格式、错误及客户端示例见 [API.md](API.md)。只接受60秒以内16kHz单声道PCM16 WAV；客户端重采样，服务器只转发。语音Key不能复用DeepSeek密钥，不写入前端或Git。免费标识和账号权限以厂商实际政策为准。

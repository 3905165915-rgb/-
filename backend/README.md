# 护老智交后端

这是参赛演示版后端，使用 FastAPI 和 JSON 文件存储，不使用数据库。JSON 存储适用于单服务器、低并发演示；正式生产部署前应替换为事务数据库并重新进行安全与隐私评估。AI适配层支持 DeepSeek OpenAI兼容接口，当前默认仍为 Mock，配置真实密钥后再切换。

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
DEEPSEEK_MODEL=deepseek-v4.1-flash
AI_FALLBACK_MOCK=true
```

真实API不可用时，接口返回503，前端应保留人工录入入口；不要把AI错误伪装成成功结果。

## 数据安全约束

- `backend/data/` 不提交到Git；使用 `seed_demo.py` 生成虚构数据。
- AI草稿必须人工确认后才会创建正式记录和任务。
- 不把API密钥、真实老人数据、录音或服务器密码提交到仓库。
- 当前服务按单进程设计，写入JSON前使用文件锁和原子替换。

## 当前接口

- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `GET /api/v1/elders`
- `GET /api/v1/elders/{elder_id}`
- `POST /api/v1/records/extract`
- `POST /api/v1/records/{draft_id}/confirm`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks/{task_id}/complete`

交班、双向核对、家属工单和过程回放将在核心记录链验证后继续增加，避免未定义接口与前端分支冲突。

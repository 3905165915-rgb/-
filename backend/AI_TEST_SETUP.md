# 搭档电脑真实AI测试配置

仓库包含`config/ai-test-secrets.enc.json`加密配置，内含项目已有DeepSeek与硅基流动语音Key；使用AES-256-GCM认证加密和scrypt派生密钥。解锁口令由负责人单独提供，不写入Git。服务器管理密码、线上JWT签名密钥和账号不在包内。

## 拉取和解锁

拉取`feat/backend`，在仓库根目录、Python虚拟环境内运行：

```powershell
python -m pip install -r backend/requirements.txt -r backend/requirements-setup.txt
python backend/scripts/setup_ai_test.py
```

提示时输入单独收到的解锁口令，输入过程隐藏。脚本只在本机生成被Git忽略的`backend/.env`，设置真实提供方、deepseek-flash和语音Key，并关闭Mock降级。不会初始化/覆盖业务数据，或改变已有账号。已有DATA_DIR、JWT签名密钥和其他设置保留；不同的旧云Key不会静默覆盖，明确替换时加`--replace-keys`。

只想校验口令而不写文件，可运行`python backend/scripts/setup_ai_test.py --check`。口令错误或文件损坏时不写配置。密钥不会显示在终端。已有进程环境变量优先于.env；如果之前设置了AI_PROVIDER=mock或旧Key，需要清除相应变量再重启后端。

## 首次启动

**仅在全新、可清空的本地演示数据目录**运行以下初始化命令；已有数据不要重复seed，脚本会重置存储。

```powershell
python backend/scripts/seed_demo.py
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

本地接口文档：`http://127.0.0.1:8000/docs`。全新演示账号admin/supervisor/caregiver/family，初始演示密码均为demo123；它们不是线上账号。前端设置`VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1`，并按[FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md)接入真实后端。

先登录取得JWT，再用`GET /api/v1/elders`取得老人ID、调用`POST /api/v1/records/extract`。返回provider应为`deepseek:deepseek-flash`，status应为pending_review；人工确认前不会生成正式记录/任务。语音页面为`http://127.0.0.1:8000/api/v1/speech/demo`，使用本地工作人员账号登录测试。切换Key或模型后重启后端。

普通pytest固定使用Mock并清空测试夹具中的云Key；只有显式`RUN_REAL_AI=1`的真实验收才联网。AI/语音失败返回真实错误，不伪装成功。真实厂商调用可能受额度、余额、限流和网络影响，合成资料验收不保证今后每次请求成功。

厂商HTTP200也不代表输出可保存：JSON结构或逐字引用不符合约束时，后端仍会拒绝并返回503。以本系统返回的provider、草稿状态和人工核对结果为准，失败时保留原文转人工录入。显式真实验收会保留合成输入的厂商原始输出，便于区分传输、格式与引用问题；这些证据不上传Git。

## 文件与共享

- `.env`、`.env.*`临时文件和业务数据不上传；`.env.example`仍可提交。
- 加密包可以随仓库共享；口令通过仓库以外的私密渠道交给获授权搭档。不要把口令写入README、Issue、代码或前端环境变量。
- 解锁后持有Key的人可以直接调用供应商API，这不是按用户授权的代用接口；仅交给测试成员，之后可换成独立测试Key或轮换现有Key。轮换后须由维护者重新生成加密包。

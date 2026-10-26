# 单服务器演示部署

后端使用 JSON 文件，不使用数据库；只运行一个 Uvicorn worker。

2026-10-21 当前后端 0.4.2/schema4，前端累计补丁 54 文件；后端重试和覆盖复核修复发布于 release06，护理员人员目录补丁发布于 release07。Windows 后端 430 passed/12 skipped，Linux 415 passed/13 skipped，前端 291 项通过，两端构建通过，独立 HTTP 61 断言通过。原账号/私有配置和既有编号保留，无 schema 迁移或重置。最新验收与开放人工测试班次见上级 `RELEASE_2026-10-21.md`。

2026-10-20 完整业务联合部署（release04）为 0.4.1/schema4。该次前端基于 4be5e22 加累计 47 文件补丁；管理端新建、AI 照护、交班、记忆、质检、变更核验和家属业务已接入。Linux 410 项回归、61 项真实 HTTP 断言、12 项真厂商验收及公网完整业务流程通过；该次前端 276 项通过。测试顺序和未实现的附件/推送等项目见上级 JOINT_TEST_2026-10-20.md。本轮未推仓库。

后续 release05 手机入口修复已发布，累计前端补丁现为 51 文件、284 项测试通过，两端类型检查/构建及 ESLint 无错误。恢复根 `/403`、护理员从根入口进入手机端，手机根登录默认进入 `/mobile/`；`/login?view=admin` 可保留管理端。HTML 入口关闭缓存和条件 304，哈希资源缓存保留；重复 location 安全头，避免 Nginx add_header 继承失效。公网主管登录、刷新、旧错误页、AI 页目录及工作台真实任务加载通过；两种手机浏览器标识模拟不等同实际手机引擎验收。最新源码和网页包在 `/root/hulaozhijiao-release-20261020-05-entry-recovery`，网页/Nginx 备份在其中 `rollback/`。该次仅更新网页和 Nginx，不重启后端、不变更数据或账号，未重复收费 AI 验收。

- 代码：`/opt/hulaozhijiao/app/backend`
- Python：`/opt/hulaozhijiao-venv`
- 持久数据：`/var/lib/hulaozhijiao/store.json`
- 环境配置：`/etc/hulaozhijiao/backend.env`（root 读取，权限 600）
- 演示账号：`/etc/hulaozhijiao/demo-accounts.json`（随机密码，不进入 Git）
- 服务：`hulaozhijiao.service`，监听 `127.0.0.1:8100`
- 管理网页：`/opt/hulaozhijiao/web/admin`，公网 `/`
- 手机网页：`/opt/hulaozhijiao/web/mobile`，公网 `/mobile/`
- 对外 API：`/api/v1`，由 Nginx 转发
- 目前实际启用的养老域名 Nginx 配置：`/etc/nginx/sites-available/hulaozhijiao`；更新前检查sites-enabled链接，不要按域名猜配置文件，否则可能重复定义限流区。

当前养老系统域名为 `https://sdau.fun/`（同时接收 `www.sdau.fun`），使用 `/etc/letsencrypt/live/sdau.fun/` 下的 HTTPS 证书。`activate_nginx.py` 会优先备份并移走旧域名站点（默认 `/etc/nginx/sites-available/99211314.xyz`，可用 `LEGACY_SITE_CONFIG` 覆盖），然后替换 `hulaozhijiao` 配置；若服务器没有独立旧域名文件，则只替换现有养老配置并保留回滚内容。`nginx -t` 成功后才 reload。HTTP 和 IP 请求重定向到 `https://sdau.fun/`。

部署必须先运行依赖安装、后端测试与前端构建。前端构建环境配置 `VITE_API_BASE_URL=/api/v1`；手机网页使用 Vite `--base=/mobile/`，路由 history 必须读取 `import.meta.env.BASE_URL`。

`configure.py` 只在数据文件不存在时初始化虚构数据和随机账号，更新代码不会覆盖数据。首次运行前，使用安全渠道在 `/etc/hulaozhijiao/deepseek.key` 写入 API 密钥（权限 600）；运行 `probe_ai.py` 核实账号可用的模型。如果指定模型不受支持，必须如实报告，并在模型选择明确后再修改配置。云端禁用 Mock 降级，调用失败返回 503。

安装 `hulaozhijiao.service` 前创建同名无登录权限的系统账号，将 `/var/lib/hulaozhijiao` 归其所有。配置文件和程序保持 root 所有。安装 Nginx 配置后先 `nginx -t`，再 reload，不覆盖已有域名站点。

验证：`python backend/deploy/verify.py`；真实 AI 调用就绪后增加 `--ai`。检查 `systemctl status hulaozhijiao`、`journalctl -u hulaozhijiao`。公网另验证首页、手机页面深链、静态资源和健康检查。

当前两端有可写业务表单；老人/床位/入住、评估/计划、AI 记录/交班/质检、记忆/核验、事件整改、家属授权/简报/反馈和统计已接入。未穷举每个参数组合，附件、独立补充交班及推送等仍未实现。手机网页不等于 APK。

## v4更新、备份及恢复

更新前复制旧backend代码和store.json到root可读的独立版本备份目录。先在Linux Python3.10上运行测试，再停服务、替换代码并加载EnvironmentFile执行 `scripts/migrate_json.py`，最后恢复数据文件属主并启动。切勿重跑seed或configure覆盖现有账号和业务。失败时回滚代码和数据后再启动。

安装 `hulaozhijiao-backup.service` 和 `hulaozhijiao-backup.timer` 至 `/etc/systemd/system/`，执行 `systemctl daemon-reload`、`systemctl enable --now hulaozhijiao-backup.timer`。北京时间每天03:15后随机延迟至多5分钟备份，补跑错过的计划。可执行 `systemctl start hulaozhijiao-backup.service` 验证，再检查 `systemctl list-timers hulaozhijiao-backup.timer`。只记录备份路径，不输出业务内容。

手动恢复：停服后，在与服务一致的DATA_DIR环境下运行 `scripts/backup_json.py --restore <当前版本备份的绝对路径> --confirm-service-stopped`，检查结果并重新启动。恢复保留当前users集合及密码散列，且先备份原数据；不会把旧账号密码复活。对于v1/v2/v3历史备份应先在隔离目录迁移副本，禁止直接覆盖v4文件。

0.3.3代码要求schema v4，迁移会新增空change_reviews集合；v1/v2还会补齐care_memories等此前新增集合，保留原有数据与未知扩展字段。不可仅替换Python文件后直接重启旧v1/v2/v3数据。迁移脚本会备份，但回滚时仍需同时还原旧代码和对应旧schema文件。新增核验队列和记忆接口的联调流程见上级CHANGE_REVIEW_API.md和MEMORY_API.md。以上为历史 schema 迁移说明；当前已为 schema4，0.4.1 更新不执行迁移。

备份和恢复流程有自动测试；部署验证只在隔离副本演练恢复，不回滚在线业务。当前备份在同一台服务器，未配置异地复制或自动清理。测试和脚本默认只使用虚构数据。

新增核心链路和接口参见上级目录 `API.md` 与 `IMPLEMENTATION.md`。DeepSeek端点接收文本，语音由独立的硅基流动转写接口提供。

0.4.0恢复备份新增保护：保留当前账号密码，但递增会话版本、清空旧幂等响应，并撤销恢复快照中所有有效家属绑定。恢复后所有用户重新登录、前端清空旧业务缓存，家属重新核实授权。恢复动作始终停服执行。

## 隔离验收与真实厂商调用

`acceptance.py`不部署代码、不reload Nginx、不写线上业务。将待验收的backend源码放入独立临时目录，使用现有服务器Python环境运行，例如：

```sh
/opt/hulaozhijiao-venv/bin/python /tmp/acceptance/source/backend/deploy/acceptance.py \
  --env-file /etc/hulaozhijiao/backend.env \
  --synthetic-audio /tmp/acceptance/synthetic.wav \
  --output-dir /tmp/acceptance/evidence
```

临时目录须仅验收人员可读。配置只在进程内读取，不能把Key写入命令行、源码或报告。音频必须是合成内容、16kHz单声道PCM16 WAV。脚本先跑默认跳过真实厂商的回归和临时HTTP服务，再显式启用12个真实配置验收用例；其中缺Key用例是故障注入，其余正常产生11次DeepSeek文本请求和1次语音请求，不自动重试。测试数据、用户与正式存储隔离。

输出包含JUnit报告、HTTP断言、真实输出、网络元数据和汇总；脚本前后只对线上store计算文件摘要并比对，不将其作为测试资料。待验Nginx模板只执行独立`nginx -t`。证据留在受控临时目录，不提交Git；真实厂商/独立机构验证的边界见上级evaluation/README.md。

生产APP_ENV=production/prod时，启动拒绝默认/不足32字符的SECRET_KEY、Mock提供方和Mock自动降级；AI_PROVIDER拼写错误也拒绝启动。新增AI上下文、交班摘要和质检location已加Nginx限流模板，且现有线上配置已包含这些路径；验收脚本本身只做隔离 nginx -t，不执行 reload。后续配置修改仍须服务器 nginx -t 成功后 reload。

## 在线语音识别

将语音Key安全写入root可读的EnvironmentFile，变量为 `SILICONFLOW_API_KEY`，可选 `SPEECH_TIMEOUT_SECONDS=45`；重启后生效。服务器不安装本地语音模型或ffmpeg。

同步 `nginx.conf` 中 `/api/v1/speech/transcriptions` 的精确location：仅此路径放开至3MiB，关闭请求缓冲、使用HTTP1.1上游，并保留频率限制。不要将其他API的64KiB限制全局放开。先备份当前配置、`nginx -t`通过再reload。

独立录音页：`/api/v1/speech/demo`；状态检查需工作人员身份。转写不保存业务数据。调用 `verify_speech.py --audio /absolute/path/to/synthetic.wav` 可验证公网，音频须为合成的16kHz单声道PCM16 WAV，不得使用真实老人录音做部署验证。该检查会发生一次真实厂商调用。

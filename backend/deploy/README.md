# 单服务器演示部署

后端使用 JSON 文件，不使用数据库；只运行一个 Uvicorn worker。

2026-10-20待交付版本为0.4.0/schema4；只读公网检查仍是0.2.1/schema2。新代码已完成服务器隔离Linux回归、真实HTTP和厂商AI/语音验收，见上级ACCEPTANCE_2026-10-20.md；本次未更新线上代码/业务。部署前仍须备份和显式迁移，不能把整个本地data目录上传覆盖。当前前端API路径和正文存在差异，见上级FRONTEND_HANDOFF.md，先完成联调再更新网站。

- 代码：`/opt/hulaozhijiao/app/backend`
- Python：`/opt/hulaozhijiao-venv`
- 持久数据：`/var/lib/hulaozhijiao/store.json`
- 环境配置：`/etc/hulaozhijiao/backend.env`（root 读取，权限 600）
- 演示账号：`/etc/hulaozhijiao/demo-accounts.json`（随机密码，不进入 Git）
- 服务：`hulaozhijiao.service`，监听 `127.0.0.1:8100`
- 管理网页：`/opt/hulaozhijiao/web/admin`，公网 `/`
- 手机网页：`/opt/hulaozhijiao/web/mobile`，公网 `/mobile/`
- 对外 API：`/api/v1`，由 Nginx 转发

本次用户明确授权将 `https://99211314.xyz/` 原站入口替换为养老系统，继续使用现有有效 HTTPS 证书。`activate_nginx.py` 先备份 `/etc/nginx/sites-available/99211314.xyz` 为同目录的 `99211314.xyz.pre-hulaozhijiao`，仅移走指定域名，保留原应用进程及其他域名；`nginx -t` 成功后才 reload。HTTP 和 IP 请求重定向到 HTTPS 域名。

部署必须先运行依赖安装、后端测试与前端构建。前端构建环境配置 `VITE_API_BASE_URL=/api/v1`；手机网页使用 Vite `--base=/mobile/`，路由 history 必须读取 `import.meta.env.BASE_URL`。

`configure.py` 只在数据文件不存在时初始化虚构数据和随机账号，更新代码不会覆盖数据。首次运行前，使用安全渠道在 `/etc/hulaozhijiao/deepseek.key` 写入 API 密钥（权限 600）；运行 `probe_ai.py` 核实账号可用的模型。如果指定模型不受支持，必须如实报告，并在模型选择明确后再修改配置。云端禁用 Mock 降级，调用失败返回 503。

安装 `hulaozhijiao.service` 前创建同名无登录权限的系统账号，将 `/var/lib/hulaozhijiao` 归其所有。配置文件和程序保持 root 所有。安装 Nginx 配置后先 `nginx -t`，再 reload，不覆盖已有域名站点。

验证：`python backend/deploy/verify.py`；真实 AI 调用就绪后增加 `--ai`。检查 `systemctl status hulaozhijiao`、`journalctl -u hulaozhijiao`。公网另验证首页、手机页面深链、静态资源和健康检查。

当前前端为独立演示骨架，大部分业务通过 localStorage 演示，部署不代表全业务接口已联调。真实数据投入前应配置 HTTPS、细化老人级授权、完善业务接口与数据备份机制。没有 Android 构建产物时，手机网页不等于 APK。

## v4更新、备份及恢复

更新前复制旧backend代码和store.json到root可读的独立版本备份目录。先在Linux Python3.10上运行测试，再停服务、替换代码并加载EnvironmentFile执行 `scripts/migrate_json.py`，最后恢复数据文件属主并启动。切勿重跑seed或configure覆盖现有账号和业务。失败时回滚代码和数据后再启动。

安装 `hulaozhijiao-backup.service` 和 `hulaozhijiao-backup.timer` 至 `/etc/systemd/system/`，执行 `systemctl daemon-reload`、`systemctl enable --now hulaozhijiao-backup.timer`。北京时间每天03:15后随机延迟至多5分钟备份，补跑错过的计划。可执行 `systemctl start hulaozhijiao-backup.service` 验证，再检查 `systemctl list-timers hulaozhijiao-backup.timer`。只记录备份路径，不输出业务内容。

手动恢复：停服后，在与服务一致的DATA_DIR环境下运行 `scripts/backup_json.py --restore <当前版本备份的绝对路径> --confirm-service-stopped`，检查结果并重新启动。恢复保留当前users集合及密码散列，且先备份原数据；不会把旧账号密码复活。对于v1/v2/v3历史备份应先在隔离目录迁移副本，禁止直接覆盖v4文件。

0.3.3代码要求schema v4，迁移会新增空change_reviews集合；v1/v2还会补齐care_memories等此前新增集合，保留原有数据与未知扩展字段。不可仅替换Python文件后直接重启旧v1/v2/v3数据。迁移脚本会备份，但回滚时仍需同时还原旧代码和对应旧schema文件。新增核验队列和记忆接口的联调流程见上级CHANGE_REVIEW_API.md和MEMORY_API.md。本次本地开发不代表已执行服务器迁移或部署。

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

生产APP_ENV=production/prod时，启动拒绝默认/不足32字符的SECRET_KEY、Mock提供方和Mock自动降级；AI_PROVIDER拼写错误也拒绝启动。新增AI上下文、交班摘要和质检location已加Nginx限流模板，并通过服务器隔离nginx -t；未reload，不代表线上配置已生效。正式更新配置仍须服务器nginx -t成功后reload。

## 在线语音识别

将语音Key安全写入root可读的EnvironmentFile，变量为 `SILICONFLOW_API_KEY`，可选 `SPEECH_TIMEOUT_SECONDS=45`；重启后生效。服务器不安装本地语音模型或ffmpeg。

同步 `nginx.conf` 中 `/api/v1/speech/transcriptions` 的精确location：仅此路径放开至3MiB，关闭请求缓冲、使用HTTP1.1上游，并保留频率限制。不要将其他API的64KiB限制全局放开。先备份当前配置、`nginx -t`通过再reload。

独立录音页：`/api/v1/speech/demo`；状态检查需工作人员身份。转写不保存业务数据。调用 `verify_speech.py --audio /absolute/path/to/synthetic.wav` 可验证公网，音频须为合成的16kHz单声道PCM16 WAV，不得使用真实老人录音做部署验证。该检查会发生一次真实厂商调用。

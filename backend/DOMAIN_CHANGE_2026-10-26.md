# 域名切换记录：sdau.fun

- 新域名：`https://sdau.fun/`
- `www` 入口：`https://www.sdau.fun/`
- 手机端：`https://sdau.fun/mobile/`
- API：`https://sdau.fun/api/v1/`

## 已修改的部署配置

- `backend/deploy/nginx.conf`：更新 HTTP/HTTPS 的 `server_name`、证书目录和 HTTP 重定向目标。
- `backend/deploy/configure.py`：新服务器初始化时将两个 HTTPS 域名加入 CORS 白名单。
- `backend/deploy/activate_nginx.py`：切换脚本改为备份并替换 `sdau.fun` 站点配置。
- `backend/deploy/verify_speech.py`：公网语音验收默认地址改为新域名。
- `backend/deploy/README.md`：更新证书、备份和上线说明。

## 上线前检查

1. 服务器上确认 `/etc/letsencrypt/live/sdau.fun/fullchain.pem` 和 `privkey.pem` 存在，且证书包含 `sdau.fun`、`www.sdau.fun`。
2. 将 Nginx 配置复制到服务器后先执行 `nginx -t`，通过后再 `systemctl reload nginx`。
3. 分别检查根路径、`/mobile/`、`/api/v1/health` 和 HTTP 到 HTTPS 重定向。
4. 确认服务器环境文件中的 `CORS_ORIGINS` 包含两个新域名；不要把密钥写入仓库。

历史发布记录中的旧域名保持不变，用于追溯当时的线上状态。

## 本次上线结果

- 已签发包含 `sdau.fun`、`www.sdau.fun` 的 Let’s Encrypt 证书。
- 已在服务器执行 `nginx -t` 并 reload，Nginx 与后端服务均为 active。
- 已发布前端管理端和手机端新构建，以及入住校验修复后的后端代码。
- 已验证 `https://sdau.fun/`、`https://www.sdau.fun/`、`https://sdau.fun/mobile/` 和 `/api/v1/health` 均可访问。
- HTTP 请求已重定向到 `https://sdau.fun/`。
- 线上业务数据未覆盖；发布前配置、后端和静态文件均保留了带时间戳的回滚备份。

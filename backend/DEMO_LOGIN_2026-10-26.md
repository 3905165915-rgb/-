# 2026-10-26 演示身份入口

## 使用
POST /api/v1/auth/demo-login
请求：{"role": "caregiver"}；其他支持 supervisor / admin / family。
返回沿用登录响应 access_token、token_type、user_id、role、display_name。
护士入口复用 supervisor 权限，不代表新增护士专业资质或临床操作权限。

## 开启与权限
仅 APP_ENV 为 demo、development 或 test 时开放，其他环境返回 404。
用户还必须 active=true 且 demo_login_enabled=true，默认 false。无匹配账号返回404。
返回正常JWT，后续操作仍遵守对应角色、工作范围和家属可见范围校验。
账号密码登录保留。本次不重置老人数据、不修改密码、不引入数据库。

## 服务器启用
只为已核实的四个演示账号启用标记，修改 JSON 时必须使用 hulaozhijiao 服务身份，保证原子写入后的文件所有权正确。启用前备份，不给其他账号默认开启。

## 验收
全量后端曾完成 634 passed / 16 skipped；补强显式禁用与停用账号边界后，4项角色登录专项测试通过。弃用告警来自 Starlette/httpx 适配，不影响本次结果。
生产上线后还需验证4角色真实登录、带凭证查老人，以及家属范围限制。

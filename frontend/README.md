# 护老智交前端

前端采用 pnpm workspace，包含管理网站和移动端两个 Vite 应用。接口请求集中在 `packages/api-client`，业务状态枚举集中在 `packages/shared`。

## 启动

```bash
corepack enable
pnpm install
pnpm dev:admin
pnpm dev:mobile
```

默认从 `VITE_API_BASE_URL` 读取后端地址，复制 `.env.example` 为 `.env` 后按需修改。移动端先以 Web 模式启动；具备 Android SDK 后再运行 `pnpm cap:sync` 和 `pnpm cap:android`。

当前骨架只负责页面、路由、请求封装和状态呈现。权限判断、评分规则、AI确认入库和业务状态流转仍以后端接口为准。

## 页面入口

- 管理端：工作台、老人档案、入住与床位、评估、照护计划、每日任务、质检台、双向核对、变化简报、家属沟通、过程回放、演示保障。
- 移动端：护理员工作台、快速记录、AI草稿人工确认、接班、家属动态、过程回放。
- 演示数据：305床王阿姨案例；可在管理端“演示保障”中重置，所有内容带演示标识。

## 与接口的边界

`packages/api-client` 已覆盖登录、老人、记录提取/确认、任务、交班、过程回放和家属诉求接口。接口返回的权限、状态和评分优先级高于前端展示；本地演示数据只用于接口不可用时的演示降级。

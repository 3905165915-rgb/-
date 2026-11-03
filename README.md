# 护老智交

管理端为 Vue 3、TypeScript、Element Plus；护理与家属移动端为 Vue 3、Vant，Android 容器使用 Capacitor。后端为 FastAPI。

当前持久化使用 schema 10 JSON、FileLock、fsync 与原子替换，线上服务限单 Uvicorn worker。事务数据库尚未迁移，方案见 [迁移与回滚计划](backend/deploy/TRANSACTION_STORAGE_PLAN.md)。

产品清单的后端实现与接口分别见 [逐项交付](backend/PRODUCT_CHECKLIST_2026-11-02.md)、[接口交接](backend/PRODUCT_API_2026-11-02.md)。前端和最终联调见 [产品验收记录](frontend/docs/产品清单验收_2026-11-03.md)。

本地检查：在 `frontend/` 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build:deploy`；后端在 `backend/` 运行常规业务测试。真实模型测试需独立配置和明确调用，不属于默认检查。

部署要求见 [部署说明](backend/deploy/README.md)。更新保留服务器账号、配置、照护资料和附件，先备份再替换；不运行数据重置脚本。

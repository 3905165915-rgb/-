# 护老智交项目开发规范

## 项目架构
- Android：Vue 3 + Vant + Capacitor
- 管理网站：Vue 3 + Element Plus
- 后端：Python + FastAPI
- 数据库：SQLAlchemy + Alembic

## 人员分工
- 成员A：frontend/
- 成员B：backend/
- 公共接口由双方确认

## 开发规则
1. 开发前先阅读 docs/PRD.md 和 docs/API.md。
2. 每次只开发一个明确功能。
3. 不得擅自修改对方负责的代码。
4. API变更必须双方确认。
5. AI生成代码必须测试。
6. 不得提交密码、密钥和真实老人数据。
7. 权限必须在后端校验。
8. AI建议必须经人工确认才生效。
9. 不得擅自推送或合并代码。

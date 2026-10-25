# DeepSeek文字与视觉共用账号：配置与验收记录

## 配置结果

- 按用户要求复用既有DeepSeek账号、密钥与`deepseek-flash`模型，不新增供应商账号。
- 本地私有`backend/.env`已配置文字与视觉；服务器私有`/etc/hulaozhijiao/backend.env`已补充视觉配置，旧配置已备份，权限保持0600。
- 服务器原有非视觉配置保持不变。未读取或修改线上老人业务数据，未替换线上代码、未重启服务、未推送仓库。
- 检查发现线上尚无`vision_service.py`。因此当前状态是“私有配置就绪、本地新代码已验证”，不是“网站已经能识别照片”。部署本轮后端和完成前端接入后才能在线操作。

配置字段：

```env
VISION_API_KEY=填写现有DeepSeek密钥的实际值
VISION_BASE_URL=https://api.deepseek.com/v1
VISION_MODEL=deepseek-flash
VISION_TIMEOUT_SECONDS=45
```

密钥仅存于私有配置，示例不含实际密钥。不能把`DEEPSEEK_API_KEY`变量名当成密钥填写；代码不展开这种引用。

官方能力依据：[视觉输入](https://api-docs.deepseek.com/guides/vision)、[模型能力与价格](https://api-docs.deepseek.com/quick_start/pricing)。价格和账号权限以供应商当时政策为准。

## 真实调用发现与修正

第一轮2次真实调用中，过暗图片正确返回无法判断，清晰演示图返回内容未通过JSON解析。不能将该次失败作为识别成功。

针对DeepSeek官方域名的请求新增：

- `thinking.type=disabled`，让有限的输出预算用于观察结果，减少思考耗时与正文截断风险。
- `response_format.type=json_object`，要求结构化结果；提示明确不使用Markdown代码块。
- 提示版本更新为`visible-observation-v2`。仍执行严格字段和非诊断校验，不把无效输出伪装成成功。
- 其他OpenAI兼容供应商不附带DeepSeek专有参数。

普通测试夹具显式清空视觉密钥、地址与模型，避免开发机配置真实Key后，常规回归意外访问云端。真实测试仅在`RUN_REAL_VISION=1`时启用。

## 验收结果

修正后真实视觉验收：**2通过，0失败**，共2次真实图片请求。

| 案例 | 实际结果 | 同时验收 |
|---|---|---|
| 代码绘制的蓝色布面/杯子示意图 | 返回可见观察，处理3337毫秒 | 人工修改、转主管审核、确认后创建关联记录、原图引用、重复请求不重复调用或保存、家属不能读取内部照片 |
| 接近全黑的无信息图 | 返回无法判断、观察为空，处理2510毫秒 | 固定提示、人工放弃、不创建正式记录 |

以上耗时是该两次调用的观测值，不是响应时间承诺。模型将合成图识别为示意图；本次不验证真实照片中的物体识别率、伤情或专业照护判断。

相关离线回归：**35通过，0失败**，覆盖视觉HTTP参数、照片权限和备份、治理统计、照护范围。本次另重跑独立服务HTTP检查，**73项断言通过**，证据为`.test-runs/runtime-vision-config-20261025.json`。此前改进清单全量603通过属于前一轮结果，本次没有用相关回归数字冒充重新全量运行。

本次合计4次真实视觉请求，包含第一轮1次未通过解析的调用。证据目录不提交Git：

- `.test-runs/real-vision-20261025-1.xml`：首次失败与无法判断路径。
- `.test-runs/real-vision-20261025-2.xml`：修正后2项通过。
- `.test-runs/real-vision-20261025-2-evidence/`：合成输入的模型输出、人工审核与调用次数，不含密钥或真实照护数据。

复现方法（在`backend/`执行，先准备私有配置）：

```powershell
$env:RUN_REAL_VISION='1'
.venv/Scripts/python.exe -m pytest tests/test_real_vision.py -q -p no:cacheprovider --basetemp=.test-runs/real-vision-new-run
```

每次复现使用新的临时目录。该命令会产生真实模型调用费用，只使用代码绘制的演示图片；所有业务写入隔离在临时JSON中。

## 仍需上线后验证

新后端部署、旧JSON显式迁移、服务重启后检查视觉状态；再由前端接入上传、分析、核对、审核和放弃入口。缺配置、网络失败或输出不合规时保留人工路径。

结果始终保留“AI识别可能有误，不构成诊断或处置建议，请人工核对”。不会自动生成诊断、事件等级、任务或长期照护偏好。

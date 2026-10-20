# 家属业务接口（后端本地版）

以下均位于`/api/v1`，前端协作者确认后接入。单机构JSON演示，schema仍为4。

## 主管端

- GET/POST `/family/accounts`：安全目录、建立家属账号；PATCH `/family/accounts/{id}`启停；POST `/{id}/reset-password`重置密码。密码12–128字符，不进审计/幂等缓存，账号变化使旧JWT失效。
- GET `/family/cases?kind=binding|summary|feedback&elder_id=...`：分页审核列表。
- POST `/family/bindings`：elder_id、当前admission_id、family_id、relationship、consent_reference、scopes（summary/feedback）、expires_at。主管先在线下核实老人/监护人授权，填写凭证编号；这不等于有法律效力的电子签名。有效期最长366天。
- POST `/family/bindings/{id}/revoke`：expected_revision、reason。
- POST `/family/summaries`：elder_id、admission_id、period_start、period_end、text、evidence。人工编写草稿，来源须同老人、当前正式版本、发生于统计区间且明确归属本次入住；旧记录未知入住归属不能用于发布。
- POST `/family/summaries/{id}/review`：expected_revision、action=publish/reject/withdraw、reason。发布需主管再次核对来源和披露范围。
- POST `/family/feedback/{id}/reply`：expected_revision、reply（对外）、reason（内部）；open→closed，回复不自动生成任务或变更计划。

## 家属端

- GET `/family/me/bindings`：仅本人当前有效授权的最小老人信息。
- GET `/family/me/bindings/{id}/summaries`：仅已发布且来源仍有效的脱敏字段，不返回原文、证据、员工、审计和草稿；来源更正后自动隐藏，须新草稿重新审核。
- POST `/family/me/feedback`：binding_id、text；GET `/family/me/bindings/{id}/feedback`仅本人反馈及对外回复。

除账号凭据操作外，写接口支持Idempotency-Key；家属授权在幂等回放之前复查。撤销、到期、停号、离院或再次入住均阻断旧授权，换床/短期外出不失效；再次入住需重新核实授权。重复有效绑定拒绝。

错误码：family_access_not_authorized(403)、family_admission_not_current、family_binding_already_active、stale_revision、summary_evidence_changed(409)；422用于不合理期限/来源区间/入住不匹配。

仍待前端联调、真实授权流程确认；不含自动定时简报、微信通知、电子签、AI自动对外发送，也不承诺收回家属已经下载/截图的内容。

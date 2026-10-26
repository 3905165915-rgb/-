# 家属业务接口（后端本地版）

以下均位于`/api/v1`。单机构JSON文件存储，本分支schema为7；家属动态扩展不增加集合、不改变schema版本。

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
- GET `/family/me/bindings/{id}/handovers`：按当前有效 binding/admission 返回已发布且来源仍有效的家属简报摘要；只返回公开摘要和空待办列表，不返回内部交班、员工、班次、来源或AI核对明细。家属授权不会穿透共享交班读取其他老人。
- POST `/family/me/feedback`：binding_id、text；GET `/family/me/bindings/{id}/feedback`仅本人反馈及对外回复。

除账号凭据操作外，写接口支持Idempotency-Key；家属授权在幂等回放之前复查。撤销、到期、停号、离院或再次入住均阻断旧授权，换床/短期外出不失效；再次入住需重新核实授权。重复有效绑定拒绝。

错误码：family_access_not_authorized(403)、family_admission_not_current、family_binding_already_active、stale_revision、summary_evidence_changed(409)；422用于不合理期限/来源区间/入住不匹配。

2026-10-27已完成隔离虚构资料的前后端联调；真实机构授权流程仍需确认。不含自动定时简报、微信通知、电子签，也不承诺收回家属已经下载/截图的内容。家属近况小结只整理已经发布的信息，内部简报仍须人工核准后发布。


## 2026-10-27 家人动态页扩展

- 家属入口先选老人再确认，列表复用当前有效绑定；无需家属进行授权操作。演示资料可预先绑定两位虚构老人。
- GET `/family/me/bindings/{id}/timeline?limit=100&offset=0`：只展示已发布且来源仍有效的简报，按区间结束时间倒序。区间是记录覆盖时间，不当作某项活动准确发生时刻；另返回 `published_at`。不输出内部原文、员工信息或审计记录。
- POST `/family/me/bindings/{id}/insights`：只依据最多30条当前已发布简报生成面向家属的近况小结，条目附简报编号及逐字引文。模型失败时保留动态；`model_status=demo`明确表示模拟结果。模型返回后重新校验授权及来源，变更则拒绝旧结果。
- GET `/family/me/bindings/{id}/photos/{photo_id}/content`：每次重新验证有效绑定、照片所属本次入住、照片已核准且 `family_visible=true`，并须关联被当前已发布简报引用的记录。
- 主管使用原照片审核接口时可明确勾选 `share_with_family=true`，默认false；拒绝的照片不能公开。家属不读取一般护理照片库。
- POST `/attachments/{id}/family-sharing`：主管设置或撤回照片分享；`expected_revision`、严格布尔值 `share_with_family`、`note`，支持幂等。开启须照片已核准且已关联记录；撤回后家属照片入口停止返回该照片。前端将此操作嵌入既有照片观察，不增加家属授权步骤。
- `scripts/reset_acceptance_demo.py` 的隔离重建结果预先关联张阿姨、李爷爷，并各有一份可读的已发布近况。该脚本会重置数据，本轮未对线上数据执行。
- 无新增数据库或数据集合，旧数据默认不开放照片。

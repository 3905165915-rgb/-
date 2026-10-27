# Core API Contracts

All routes are under `/api/v1`. Staff routes must validate the active account, elder scope, current admission, and source revision on the server. A hidden frontend control is not an authorization check.

## Inline Care Records

- `POST /elders/{elder_id}/record` persists a formal record, then analyzes that saved record in the same request. The response contains `record`, `analysis_status`, and `analysis`. AI failure does not roll back the record.
- Failed analysis optionally includes `analysis_error: {code, message}`. Safe codes distinguish timeout, rate limiting, configuration, invalid output and unavailable service. The message is predefined Chinese text; provider details are never returned. Older clients may ignore this field.
- `POST /elders/{elder_id}/records/{record_id}/analyze` retries analysis for the same record ID and current revision; it must not create a second record.
- `POST /elders/{elder_id}/records/{record_id}/analysis/{analysis_id}/confirm` accepts reviewed preference decisions and complete follow-up tasks. Use `Idempotency-Key`; reject stale revisions and evidence not present in the cited source.
- Explicit recurring wording such as daily, weekly, or often may become a long-term preference after submitter confirmation. Ambiguous frequency and one-time wishes remain recent observations.

## Handover

- `POST /handovers/{handover_id}/ai-summary` accepts `{expected_revision, text}` and returns an editable summary, source evidence, and task suggestions.
- `POST /handovers/{handover_id}/submit` accepts the reviewed summary and complete `accepted_tasks`. Existing task source IDs continue unchanged; incomplete suggestions do not create tasks.
- Managers may inspect handover detail. Caregiver responses are limited to authorized elders and handover summaries/tasks. Family endpoints return only reviewed, published family summaries under the current binding; they never expose internal handover detail.

## Timeline

Timeline filters, ordering, and pagination use server-generated `recorded_at`. Optional `happened_at` is shown separately and never determines event ordering.

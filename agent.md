# Backend agent notes

## Scope and architecture
- Backend source is in `backend/`; FastAPI APIs use the existing JSON store and service layer.
- Read `AGENTS.md`, `docs/PRD.md`, `docs/API.md`, and `backend/API.md` before changing behavior. Confirm shared API changes with the frontend owner and preserve compatibility unless the approved design says otherwise.
- Enforce role, elder, admission, and authorization scope on the server. Frontend visibility is never authorization.

## Elder workspace rules
- Persist the formal care record before inline AI analysis. If analysis fails, retain the record and retry analysis against that same record ID and revision; never resubmit the record.
- Keep evidence and frequency classification with every AI suggestion. Explicit recurring wording such as daily, weekly, or often may become a long-term preference after the submitting staff member confirms it; ambiguous frequency and one-time wishes remain recent observations.
- AI-created follow-up tasks require one human confirmation with complete elder, assignee, shift, due time, and completion criteria. Reject stale source revisions and duplicate tasks.
- Handover analysis must preserve existing task IDs. Create only complete, explicitly accepted new tasks. Redact internal details by role; family views may expose only a reviewed family summary under a current binding.
- Timeline ordering, filtering, and pagination use server registration time; actual occurrence time remains a separate field.
- Incomplete assessments may be saved as `pending_observation`; they have no official score and cannot drive care plans or professional conclusions.
- AI may prefill only answers with attributable evidence. Missing evidence stays unanswered; contradictory evidence requires human review.
- Ordinary follow-up automation requires an explicit supervisor policy and backend validation of evidence, time, assigned worker, shift/scope, and duplicates. Professional care decisions remain human-controlled.

## Safety and data
- Never commit credentials, tokens, production settings, or real elder/patient data. Tests and deployment acceptance use synthetic data.
- Do not reset or seed over existing production data. Schema changes require an explicit, backup-first migration and a tested recovery path.
- Keep the JSON store single-writer/single-worker unless the persistence architecture is deliberately replaced.

## Verification and release
- Run tests from `backend/` with `python -m pytest -q` and add focused tests for changed authorization and persistence behavior.
- For production, follow `backend/deploy/README.md`: back up code and data, stage and test, migrate explicitly, preserve ownership/configuration, then verify service and public health endpoints.
- Report actual test and deployment results; never describe a push or deployment as complete until verified.

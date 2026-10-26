# Backend agent notes

## Scope and architecture
- Backend source is in `backend/`; FastAPI APIs use the existing JSON store and service layer.
- Read `AGENTS.md`, `docs/PRD.md`, `docs/API.md`, and `backend/API.md` before changing behavior. Confirm shared API changes with the frontend owner and preserve compatibility unless the approved design says otherwise.
- Enforce role, elder, admission, and authorization scope on the server. Frontend visibility is never authorization.

## Elder workspace rules
- A saved care record is the source of truth; background AI organization must not prevent or duplicate the save.
- Keep AI observations separate from confirmed care instructions. Only an authorized human decision can promote an observation.
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

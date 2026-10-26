# Frontend agent notes

## Scope and architecture
- Frontend source is in `frontend/`, a pnpm workspace with admin, mobile, shared UI, and API client packages.
- Read `AGENTS.md`, `docs/PRD.md`, and `docs/API.md` before changing behavior. Keep shared API contracts aligned with the backend and preserve existing route compatibility.
- Prefer shared workflow components for behavior that must match between admin and mobile. Use the API client rather than bypassing backend authorization.

## Elder workspace rules
- Keep the main elder workflow focused on today's care, understanding this elder, records, and assessment/planning.
- Show confirmed care information separately from unverified AI observations. Clearly label evidence and pending decisions.
- Incomplete assessments may be saved as pending observation, but must not appear as official scores or as care-plan inputs.
- Distinguish saved records from background processing status; retries must not create duplicate submissions.
- AI suggestions and professional care decisions must not be presented as approved until the backend confirms an authorized human decision.

## Safety and data
- Never commit credentials, tokens, production settings, or real elder/patient data. Use synthetic data for tests and demos.
- Treat role-based frontend menus as usability only; rely on server authorization for access control.
- Keep production base paths and deep-link behavior intact for both `/` and `/mobile/` deployments.

## Verification and release
- From `frontend/`, run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build:deploy` for release validation.
- For browser workflows, use synthetic data and verify both admin and mobile entry points where shared behavior changed.
- Report actual test, push, and deployment results; never describe a release as complete until verified.

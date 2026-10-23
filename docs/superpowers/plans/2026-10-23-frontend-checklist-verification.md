# Frontend Checklist Verification

- Date: 2026-10-23
- Branch: `feat/frontend`
- Scope: frontend code and isolated local verification only.

The two 2026-10-21 PDFs define product and acceptance requirements. Their
contents were treated as requirements to evaluate, not as operational
instructions. No backend source, live service, production AI, or real resident
data was used.

## Frontend Items

| Item | Result | Evidence and boundary |
|---|---|---|
| F01 Unified record entry | Implemented; backend acceptance pending | Mobile record flow supports text/audio source, retained original text, AI draft review, manual fallback, and explicit confirmation. Unit and mocked API cases cover AI failure and uncertain network writes. Real AI quality is not evaluated. |
| F02 Task creation | Implemented on supported API contract | Mobile task creation and admin task form use supported manual-record/task-candidate contract; required owner, due time, source and completion criteria are collected. Mocked API verifies one creation and durable receipt. Backend business validation still requires joint acceptance. |
| F03 Personalized care hints | Partially implemented | Task care-context panel reads authorized, scene-filtered server data and presents evidence/status. Memory lifecycle, confirmation rules and durable versions depend on backend capabilities and are not claimed as end-to-end complete. |
| F04 Item-level handover | Partially implemented | Existing stable task references, receive/clarify flows, refresh recovery and cross-midnight UI paths pass local regression. Formal API handover submission is unavailable in the inspected contract; no server-side completion claim. |
| F05 Change preview | Partially implemented | Change-review workflow entry and supported per-item review forms are exposed. Exact-reference impact completeness, stale-preview application and audit behavior require backend route/fixture support. |
| F06 Family boundary | Implemented in frontend; server authorization remains authoritative | Family route guards and family-scoped API usage are covered; direct internal-route access is rejected in mocked browser tests. The client does not substitute for backend access control. |
| F07 Navigation | Implemented | Admin navigation is business-grouped; mobile exposes Today, Elders, Handover and Account; editor-focused routes and route guards are tested. |
| F08 Short names and visual system | Implemented and locally layout-verified | Existing palette, restrained glass, account/recovery entry and mobile/admin responsive layouts were checked in browser at the UI suite's 320/390/430 and 1024/1280/1440 widths. The broader API workflow suite also checks 320/375/390/768/1366 widths. |
| F09 Recovery and conflicts | Implemented for covered frontend workflows | Synchronous form journaling, per-writer branches, account scope, version checks, uncertain-write protection and restricted replay have unit/API/demo regression coverage. Backend reconciliation of unknown writes still needs a supported status endpoint where replay is unsafe. |

## Acceptance Cases

| Case | Result | Verification boundary |
|---|---|---|
| T01 Temporary intent with follow-up | Partial | Manual fallback retains the exact original phrase and does not inherit AI guesses. The backend must confirm intent classification and persistence semantics. |
| T02 Vague “tomorrow” intent | Partial | UI requires human completion of owner/time/criteria; no model output is treated as a formal assignment. Semantic extraction correctness was not tested against a live model. |
| T03 Repeated refusal | Backend blocked | Frontend does not silently rewrite stable preference; an end-to-end review trigger requires backend event/lifecycle support and fixture evidence. |
| T04 Duplicate task submit | Mocked API pass | Browser test verifies a single mutation and restored server receipt; production backend idempotency behavior is not exercised. |
| T05 Overnight shift | Local workflow pass | Cross-midnight shift and handover regressions pass with synthetic data. Production shift membership and authoritative server state remain backend checks. |
| T06 V1-to-V2 impact set | Backend blocked | UI supports source-change review, but authoritative explicit-reference impact calculation and history preservation need backend contract/evidence. |
| T07 Unrelated caregiver access | Mocked API pass | Family/internal route boundary is exercised with isolated browser fixtures. Real backend authorization must be separately tested. |
| T08 AI timeout fallback | Mocked API pass | AI 503/network failure retains source text and permits manual workflow without auto-confirmation; no real AI service was called. |
| T09 Mobile 390px and responsive layouts | Browser pass | No overflow at 320/390/430 mobile and 1024/1280/1440 admin in `e2e/ui.mjs`; mocked workflow layouts also checked at 375/768/1366. |
| T10 Stale preview after task acceptance | Backend blocked | UI has version-conflict handling, but authoritative preview/apply revision comparison needs a backend-supported operation and race fixture. |

## Verification Results

- Unit tests: `node node_modules/vitest/vitest.mjs run` - 26 files, 410 tests passed.
- Admin typecheck: `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` from `frontend/apps/admin-web` - passed.
- Mobile typecheck: same command from `frontend/apps/mobile` - passed.
- Admin production build: `node node_modules/vite/bin/vite.js build` from `frontend/apps/admin-web` - passed.
- Mobile production build: `node node_modules/vite/bin/vite.js build` from `frontend/apps/mobile` - passed after the final spacing adjustment.
- Demo build: `node node_modules/vite/bin/vite.js build --config vite.demo.config.ts --mode demo` from `frontend` - passed after the final spacing adjustment.
- UI browser regression: `$env:BROWSER_CHANNEL='msedge'; node e2e/ui.mjs` - all 10 checks passed, including handover-footer/tabbar non-overlap and both recovery-log entry points.
- Mocked API workflow browser regression: `$env:BROWSER_CHANNEL='msedge'; node e2e/workflow.mjs` - 8 checks passed, including task create/restore, uncertain result, AI fallback, multi-window conflict, family restriction, and mobile/admin widths; 0 runtime errors.
- Demo regression: `$env:BROWSER_CHANNEL='msedge'; node e2e/all.mjs` - 24 checks passed, including storage upgrade, draft recovery, task/handover flows, family boundary and UI overflow.
- Full ESLint: 0 errors, 762 warnings, primarily Vue template formatting rules. Focused lint for changed recovery/navigation files: 0 errors and 0 warnings after the account-page formatting fix.
- `git diff --check` - passed; line-ending conversion notices are informational.

The demo and API browser suites use existing local Vite servers on ports 5175
and 5176 and synthetic identities. They were left running because they predated
this verification and belong to the user's preview environment.

## Remaining External Acceptance

Backend owners still need to verify memory lifecycle and permissions, formal
handover submission, exact-reference impact previews and stale revision checks,
unknown-write status reconciliation, production idempotency, and service-side
family authorization. Real device keyboard/safe-area behavior and real model
quality remain outside this local browser run.

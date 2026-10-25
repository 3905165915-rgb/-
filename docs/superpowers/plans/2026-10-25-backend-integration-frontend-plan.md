# Backend Integration Frontend Implementation Plan

> **For agentic workers:** Execute the tasks in order and verify each API boundary against `origin/feat/backend` at `a6c0a6f`. Do not merge or edit backend files. Steps use checkbox syntax for tracking.

**Goal:** Connect the approved frontend pages to the completed backend interfaces for private photo observation, evidence-free safety reporting, server notifications, the full dashboard, caregiver work scope, and paginated elder timeline.

**Architecture:** Keep the current Vue/Vant/Element Plus and shared workflow structure. Use the existing authenticated API client for JSON and add a binary request path that shares its base URL, bearer token, timeout, and error handling. Keep human confirmation, revision checks, idempotency, object permissions, and truthful unavailable/failed states.

**Tech Stack:** Vue 3, TypeScript, Vant, Element Plus, existing shared workflow package, Vitest, Playwright.

## Global Constraints

- Modify frontend and this task's documentation only; do not edit or merge `backend/`.
- Match the committed backend contract at `origin/feat/backend` `a6c0a6f`, including `/api/v1` routes, JSON shapes, statuses, revision fields and idempotency headers.
- Do not claim real-backend acceptance; the backend report says this build is not deployed. Use mocked HTTP tests and identify real login/service checks as pending.
- Never put credentials in URLs, persist private photo URLs, or permit family-role access to internal data.
- Photos are raw JPEG/PNG binary requests up to 4 MiB; locally validate type/size, use authenticated Blob reads, and revoke object URLs.
- Model output remains a draft. Human review is required; no diagnosis, triage, task or long-term memory is inferred from a photo.
- Preserve original text, local recovery, uncertain-write locks and existing role boundaries.

---

## Task 1: Photo Observation

**Files:** `frontend/packages/shared/src/workflow/WorkflowPanel.vue`; new shared photo workflow component/model/tests; API client binary transport/tests; frontend workflow contract only if this screen's route is contract-driven.

- [x] Add authenticated raw binary upload with elder, aware occurrence time, caption, MIME type and stable idempotency key.
- [x] Validate JPEG/PNG and 4 MiB client-side; backend remains authoritative for pixel count/content.
- [x] Add authenticated image Blob retrieval and revoke local preview URLs when photo or page changes.
- [x] Implement upload, analysis polling/detail, editable observation, reject/discard, management-review and confirmation states using documented response fields.
- [x] Keep professional review mandatory when requested and link a confirmed photo to the actual created record; never save model text without human review.
- [x] Verify binary headers/body, limits and role rules with unit tests; verify polling stop, private previews, recovery and idempotency with mocked browser tests.

## Task 2: Evidence-Free Safety Report

**Files:** `frontend/packages/shared/src/workflow/care-context.ts` and tests, `contract.json`, `WorkflowPanel.vue`, incident labels/tests.

- [x] Make first-report evidence optional in UI and payload while keeping elder, admission, event time, facts and immediate action required.
- [x] Clear admission and evidence on elder switch; when evidence exists validate same elder/admission, current revision and source quote.
- [x] Align `IncidentCreate` required/minItems metadata and add Chinese labels for all backend categories including `restraint` and `injury`.
- [x] Keep human-only submission, stable idempotency on retry, conflict/permission error preservation and successful pending-triage status.
- [x] Test no-record caregiver submission, optional empty evidence, cross-elder rejection, duplicate prevention and failure recovery.

## Task 3: Server Notifications

**Files:** shared `PendingWork.vue`/model/tests and both app pages/routes as needed.

- [x] Replace list concatenation and local read writes with `/notifications` pagination and server `unread`/`pending` filters.
- [x] Add server `read` and `accept` actions using the returned revision and an idempotency key; don't mutate linked business status.
- [x] Render person, Chinese object/stage/status, timestamp, current handling state and data refresh time.
- [x] Preserve backend page results on transient errors; refresh after action and after linked business navigation; stop polling on unmount.
- [x] Test pagination, filters, action conflicts, role access, stale responses and that accept does not report business completion.

## Task 4: Single-Response Management Dashboard

**Files:** `frontend/apps/admin-web/src/pages/dashboard/DashboardPage.vue`, dashboard model/tests.

- [x] Replace `/reports/metrics` plus parallel list requests with `/reports/dashboard` and documented filters.
- [x] Validate and render cards, distributions, task trend, pending work, same-response details, comparison, excluded values and definitions.
- [x] Refresh all areas together on date/elder/shift/status change; invalidate stale requests and preserve one `as_of`/filter snapshot.
- [x] Add accessible desktop hover and mobile click chart interactions, Chinese enum labels, zero/null handling and drilldown by returned IDs.
- [x] Test prior-period zero, ratios, limit errors, requests races, filters, count-detail equality and 320/390/430 plus desktop layouts.

## Task 5: Care Scope Workbench And Assignments

**Files:** caregiver workbench, admin elder/staff or dedicated assignment page, routers, shared labels, model/tests.

- [x] Use `/elders/worklist/me` as the source of assigned elder cards, including elders with zero tasks.
- [x] Show scope reasons, readable bed/name, pending/overdue counts and safe links; display the supervisor-contact empty state.
- [x] Add management assignment/revoke UI using documented fields, revisions and idempotency keys.
- [x] Refresh after assignment changes and ensure revoked/expired scope is reflected without role-switch or unrestricted-list fallbacks.
- [x] Keep unsent record text when scope changes and surface access loss for user review.
- [x] Test zero-task assignments, latest revoked/expired worklist handling, caregiver/admin differences and existing local recovery regressions. End-to-end scope-revocation during editing remains a real-service acceptance item.

## Task 6: Server Elder Timeline

**Files:** shared `ElderActivity.vue` and model/tests, mobile elder detail page.

- [x] Replace browser aggregation of multiple lists with `/elders/{id}/timeline` pages and server-provided totals/notice.
- [x] Send event types and timezone-aware date filters; load next pages without duplicates.
- [x] Preserve exact authorized source navigation, account/elder-switch race guards and inaccessible-source handling.
- [x] Test pagination, filters, dates, revoke/403, no duplicate events and no cross-elder response leakage.

## Task 7: Verification And Handoff

- [x] Run focused unit tests after each task, then all Vitest tests, both typechecks, both production builds and demo build.
- [x] Run mocked API browser tests for all connected pages and existing workflow/UI regressions at 320/390/430 and desktop sizes.
- [x] Run ESLint on changed files and `git diff --check`; inspect working-tree and untracked scope for backend, credentials, real data and generated outputs; do not stage temporary outputs.
- [x] Update plan checkboxes and write a difference/verification report that clearly separates mocked frontend verification from pending real-backend integration.

## Pending Real-Service Acceptance And API Gaps

- [ ] Verify real login, deployment/base URL/CORS, cross-account permissions and private photo access against a running backend.
- [ ] Verify the configured vision provider, unavailable/provider-failure paths, actual audit persistence and formal-record creation.
- [ ] Verify permission revocation during editing preserves unsent text and blocks subsequent unauthorized writes across two accounts.
- [ ] Provide assignment list/detail/current-revision interfaces before claiming complete historical assignment management. This frontend currently supports creation and revocation for receipts known to the current account/browser session.

**Verification record:** See docs/前端接入改进差异与验收记录_2026-10-25.md. Checked implementation steps describe frontend and synthetic HTTP verification only; they do not certify deployment or real-backend acceptance.

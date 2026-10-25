# 2026-10-25 Final Checklist V2 Implementation Plan

> Execution: use subagent-driven-development for bounded tasks and review each returned change. The user has requested implementation and incremental verification in this session.

**Goal:** Close the frontend gaps against the 2026-10-25 v2 division checklist without changing backend ownership or inventing service capabilities.

**Architecture:** Retain Vue 3, Vant, Element Plus, TanStack Query and the existing reviewed WorkflowPanel. Share small tested models between mobile/admin. Existing API responses and server permissions remain authoritative; aggregation from authorized lists is explicitly scoped and is not a new backend timeline or notification service.

**Baseline:** `origin/feat/frontend` / `83bb7ae`, fast-forwarded from `4f71ec9`; clean before this work. The attachment was read as requirements, not operational instructions. `docs/PRD.md` and `docs/API.md` currently contain no substantive contract; the checked-in contract and read-only `origin/feat/backend` routes/services supply the available wire shapes.

## Global Constraints

- Change frontend and task documentation only; do not edit backend or deploy/push during this implementation request.
- Preserve human confirmation, original record text, draft journals, uncertain-write protection, revision checks, role boundaries and idempotency.
- Use server-authorized lists, never infer permanent responsibility from historic records. Family accounts cannot access internal pages.
- No real resident data, credentials, production writes or real AI calls during tests.
- Preserve the approved restrained glass style; high-contrast content, 320px minimum responsive layout, reduced-motion and reduced-transparency support.
- Photos require controlled upload/access and a declared recognition response; do not send base64 files to unrelated JSON fields or claim unsupported AI analysis.

## Difference Matrix

| Requirement | Existing behavior | This round / remaining dependency |
|---|---|---|
| P0 elder-first workbench | Task-first page with search | Add authorized task-linked elder cards, pending/overdue counts, real available changes/notes and direct record/task/detail actions. |
| P0 elder detail / timeline | Profile, impressions, tasks; item-level replay | Add date/type filtered authorized-list activity, exact source links and item replay. Formal paginated elder aggregation remains backend work. |
| P0 unified record | Text/speech/manual fallback, inline review, discard candidates already present | Retain and verify; rename caregiver entry consistently to 记一条, expose safety path without AI dependency. |
| P0 task create | Reviewed manual-record contract; elder, owner, due, criteria | Show elder-related tasks and scene-confirmed hints before task fields; changing elder cannot retain another elder's context. |
| P0 safety report / center | Generic incident workflow only in admin | Add guarded mobile safety route and entry points; Chinese labels, elder-scoped evidence, admission/context support. Existing create requires confirmed record evidence; evidence-free emergency reporting needs backend changes. |
| P1 notifications | No persistent notification API | Provide explicitly scoped current pending-work queue from supported objects with direct navigation; local read state is not remote read/handled state. Do not claim notification persistence across devices. |
| P1 handover | Formal preparation/submit, source detail, receive and clarify available | Verify and improve entry/context only where needed; retain human review of AI draft. |
| P1 family | Scoped bindings, published summaries and feedback routes | Regression-test boundaries; do not expose internal objects or broaden scopes. |
| P1 photos | No controlled upload or visual model contract | Clearly identify unavailable remote upload/recognition; preserve manual/text/audio workflow. Document required contract and acceptance cases rather than simulate success. |
| P1 dashboard | Snapshot cards and generic metrics form | Add shared date window, server timestamp/definitions, real charts for available metrics and exact-object drilldown. Missing dimensions and previous-period deltas stay unavailable, not zero. |
| P2 visual feedback | Glass/transparency preferences and motion CSS exist | Add restrained hover/press to repeated clickable cards; honor reduced motion; verify layouts. |

## Task 1: Elder Workbench And Activity

Files: mobile `pages/caregiver/CaregiverPage.vue`, `pages/elders/ElderDetailPage.vue`; new shared `workflow/elder-activity.ts`, its tests and `ElderActivity.vue`; new mobile workbench helper/tests if useful. Preserve existing task filters and demo tests.

- [x] Map authorized elders/tasks to elder-first cards; do not invent care hints or changes when absent.
- [x] Aggregate only accessible exact-elder records/tasks/handover items/incidents/memories with explicit timestamps; date/type filters, source drilldown, errors/retry and empty states.
- [x] Guard late loads after elder/account changes; avoid showing another elder's activity during switch.
- [x] Unit-test elder isolation, end dates, invalid timestamps, pending/error, exact relations and reference URLs; typecheck modified pages.

## Task 2: Management Dashboard

Files: admin `pages/dashboard/DashboardPage.vue`; new admin dashboard helpers/tests/components as needed. Existing `/reports/metrics` response is authoritative; source `backend/app/services/report_service.py` is readable via git show.

- [x] Date window uses Asia/Shanghai inclusive start/exclusive end; all charts refresh together, with server as_of/window/definitions.
- [x] Show validated real aggregates for plan tasks, handover, incidents and family feedback. Distinguish zero denominator from 0%; reject malformed data.
- [x] Provide accessible interactive charts with tooltips and a drilldown list filtered using actual source object fields and the same metric definition (occurrence leaves, future exclusion, interval/status). Missing dimensions explicitly unavailable.
- [x] Tests cover future exclusion, replacement chains, dates, empty denominator, drilldown predicates, invalid responses and request races.

## Task 3: Safety, Pending Work And Context

Files: mobile/admin routers/layouts/access/account/record/detail entry points as needed; shared WorkflowPanel/WorkflowField/model; new shared pending-work model/component/tests and frontend page wrappers.

- [x] Add mobile safety entry with human-only incident workflow, consistent title 照护安全与事件上报 and Chinese categories/statuses; direct object context works in admin too.
- [x] Scope evidence, admission and related records to selected elder. On elder changes clear stale links. Preserve journals, version conflicts and uncertain writes.
- [x] Add current pending-work view based on accessible drafts, handovers and assigned incident rectifications. Read tracking is local/account-scoped; processing depends on authoritative object status. Family denied.
- [x] Task creation displays related tasks and scene-based confirmed hints; unrelated elder data and candidates are not carried over.
- [x] Photos show the missing controlled-upload/recognition boundary in the record page without blocking text/audio/manual save.
- [x] Add focused regression tests for role isolation, source filtering, read vs handled, changed objects and unsupported capabilities.

## Task 4: Integration And Verification

- [x] Run the full unit suite and both Vue typechecks; fix regressions.
- [x] Run both production builds and demo build.
- [x] Run focused mocked API browser tests for elder entry, activity filters/links, safety manual/no-AI, pending queue state, task elder switch and dashboard date/drilldown/error flows.
- [x] Reuse demo/UI regressions at 320/390/430 mobile and common desktop widths; inspect screenshots for new surfaces and ensure no overflow/overlap.
- [x] Run focused lint and git diff --check. Record actual results and remaining backend interfaces in `2026-10-25-final-checklist-v2-verification.md`.

## Required Backend Handoff

1. Authoritative current-shift/temporary-support elder scope and paginated elder activity with event/object references, permissions, dates/types and cursor.
2. Safety facts-first urgent reporting if no confirmed record exists; current contract requires admission and at least one current formal-record citation.
3. Notifications list/counters/read/accept/return/close with object links, revisions and idempotency; read is separate from processed.
4. Controlled multipart attachments, scoped signed retrieval, limits/ownership/deletion, recognition jobs/results/model version/non-diagnostic uncertainty and human-review lineage.
5. Aggregates for dated trend/category/status/memory/brief dimensions, previous-period comparisons and exact drilldown predicates under one server snapshot.

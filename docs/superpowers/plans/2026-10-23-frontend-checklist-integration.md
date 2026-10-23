# Frontend Checklist Integration Implementation Plan

## Scope

Execute the approved F01-F09 design against the two 2026-10-21 PDF plans.
Only frontend code and this implementation's documentation may change. Preserve
the existing approved UI and recovery protections. Use documented backend
contracts, local fixtures and synthetic identities only. Do not push, deploy,
modify backend code, or call live AI services.

## Tasks

1. Integrate the reviewed cumulative frontend API patch based on 4be5e22.
   Review its paths and API contracts; run contract/model tests and typechecks.
2. Audit formal workflows for durable recovery, conflicts, idempotency,
   human confirmation and role boundaries. Repair concrete regressions with
   focused tests before extending functionality.
3. Complete supported business entry points and checklist gaps, especially
   task creation, four-section mobile navigation, care-memory context and
   explicit source-change review. Never fabricate a missing backend operation.
4. Run all frontend tests, lint, both typechecks and both production builds.
   Exercise isolated mocked API workflows and existing demo routes in a browser
   at 320, 375, 390, 768 and 1366 pixels. Fix observed failures.
5. Record F01-F09/T01-T10 coverage, reproducible commands and actual results,
   with backend/device limitations separated from verified frontend behavior.

## Commands

From frontend/: `node node_modules/vitest/vitest.mjs run`,
`node node_modules/eslint/bin/eslint.js .`,
`pnpm dlx pnpm@9.15.5 typecheck`, `pnpm dlx pnpm@9.15.5 build`,
`pnpm dlx pnpm@9.15.5 build:demo`.

## Progress

- Baseline: clean feat/frontend at 83676a6; existing 249 tests passed earlier.
- Patch candidate: 54 frontend files, clean application verified, backend ref
  588f01225c7e8608b257079fb9dbf5692b1c0592.
- Task 1: complete. The frontend integration is present on the existing
  `feat/frontend` worktree. Shared package peers and lockfile now declare the
  router dependency required by the shared workflow component.
- Task 2: complete. Formal workflow recovery retains account-scoped journals,
  compare-and-set version conflicts, uncertain-write locks, and replay only on
  backend routes verified to support idempotency.
- Task 3: complete for supported frontend routes: mobile elder/task entry,
  supported manual task creation, care-context panel, workflow catalog,
  explicit change review, and four-section mobile navigation. Unsupported
  business operations remain explicitly unavailable.
- Task 4: complete for available local verification. See
  `2026-10-23-frontend-checklist-verification.md` for commands and limitations.
- Task 5: complete. F01-F09 and T01-T10 are mapped with evidence and backend
  acceptance limits in the verification report.

## Final Boundary

- No backend files, live services, production AI, real elder data, commits,
  pushes, or deployments were used.
- The current checkout remains uncommitted and unpushed. Existing unrelated
  worktree edits are preserved.

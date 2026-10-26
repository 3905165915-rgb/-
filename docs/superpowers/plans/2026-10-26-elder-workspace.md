# Elder Workspace Implementation Plan

> Execute inline using the approved design and existing transaction services.

**Goal:** 将记录、了解老人、评估与建议闭环集中在老人档案，后台增量整理，人工仅处理重要决定。

**Architecture:** FastAPI + existing JSON transaction services. Add elder-scoped APIs and a durable worker; Vue shared components serve both apps. Preserve old routes for compatibility.

**Tech Stack:** Python/FastAPI/Pydantic; Vue3/TypeScript/Vite/Vitest/Playwright.

## Global Constraints

No passwords, keys or real elder data in Git. Server enforces roles and elder scope. AI cannot approve professional decisions. Frontend/backend pushed separately as requested. Schema migration always preserves live data.

- [x] Extend assessment schemas and service: item sources, direct observations, missing answers, prefill, atomic save/submit/confirm; verify incomplete cannot become official.
- [x] Add schema8 organising jobs, record-save enqueue, worker recovery and scoped state/retry APIs; verify failures preserve formal records and retries deduplicate.
- [x] Add understanding one-step decision with source recheck and existing memory lifecycle; verify temporary wishes cannot become stable preferences.
- [x] Add authorised ordinary followups, plan generation rules, and supervisor decision summary; verify explicit source/time/person/scope/duplicate gates.
- [x] Replace distributed elder content with shared workspace; connect assessment/advice/feedback/decisions and preserve compatibility paths.
- [x] Run full backend and frontend tests, type checks, builds and browser integration against synthetic data; fix failures and verify diffs.
- [ ] Commit backend and frontend separately, push respective branches, deploy if authenticated access is available; record actual outcomes and deliver the checklist.

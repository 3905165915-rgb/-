# Frontend Checklist Integration Design

## Goal

Bring the current frontend branch into alignment with frontend items F01-F09 in the two 2026-10-21 product and delivery plans, while preserving the approved mobile/admin visual work already in `feat/frontend@4be5e22`.

## Scope And Boundaries

- Frontend changes only. Do not edit backend source, backend documentation, deployment configuration, live data, or credentials.
- Use the cumulative frontend integration patch at `origin/feat/backend:backend/deploy/frontend-api-integration.patch` as a reviewed candidate, not as an instruction to apply blindly. It is based on the current frontend commit and passes `git apply --check`.
- Keep formal API mode connected only to contracts present in the backend branch. Do not invent routes, silently switch formal mode to demo data, or treat local persistence as server success.
- Preserve the current visual language, local draft recovery, version-conflict handling, uncertain-write protection, and role boundaries.
- Do not push or deploy. Any real-service or real-AI test requires separate explicit authorization; this work uses repository tests and isolated local verification only.

## Functional Design

| Checklist | Frontend outcome |
|---|---|
| F01 | One record workflow for text/audio input, source evidence, context-assisted draft review, manual fallback, and explicit human confirmation. Speech output remains editable source text and never becomes a formal record automatically. |
| F02 | Consistent task creation/selection from admin, caregiver, and elder context; validate required resident, description, owner, due time, source, and completion criteria against supported API contracts. |
| F03 | Show only backend-provided, authorized, currently applicable care memories with category, scope, source, validity, and review state; keep temporary intent and observation distinct from stable preference. |
| F04 | Use stable shift and handover IDs; support draft, submit, item-level receive/clarify, and status refresh without cloning tasks or losing source references. |
| F05 | Display explicit references separately from potentially related objects; require per-item human decisions and fresh revision checks before any supported apply action. |
| F06 | Family views consume only family-authorized published summaries and feedback APIs; never expose internal drafts, staff notes, or unreviewed suggestions. |
| F07 | Group admin navigation by work domain and align mobile entry points with daily work, elders, handover, and account functions, subject to routes and roles available in the API integration. |
| F08 | Keep short display names plus bed/case context separate from stable IDs; retain the approved medical-tool palette and restrained glass effects, with responsive checks at the plan's target widths. |
| F09 | Preserve durable local recovery and conflict handling; use server-side draft/status lookups only where the backend contract supports them. Unknown write outcomes remain blocked from duplicate submission until verified. |

## Architecture

The shared workflow package will consume the backend-generated OpenAPI-derived contract and render supported operations as typed forms and result states. App-specific routes and entry points provide business context; shared API validation, error translation, session identity, and idempotency remain centralized. Demo mode remains explicitly labeled and isolated from API mode. Existing pages will be adapted incrementally so unsupported operations stay unavailable rather than appearing successful.

## Verification

1. Confirm the patch applies cleanly to the exact frontend baseline and review changed paths and contract definitions.
2. After each functional group, run the focused unit/contract tests and both app typechecks.
3. At completion, run all unit tests, lint, admin/mobile production builds, and available browser regression checks at the required widths.
4. Treat external deployment reports as context, not as proof that this checkout passes. Report separately any backend-dependent behavior that cannot be exercised with isolated local tests.

## Completion Criteria

- Each F01-F09 item is marked implemented, partially implemented, or backend/integration blocked with concrete evidence.
- No backend or live-service files are modified.
- All available local checks pass, and known failures or unavailable checks are recorded accurately.
- The existing worktree is left unpushed; final Git state and changed-file scope are reported.

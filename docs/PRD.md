# Elder Care Workflow Requirements

## Record and Understand

Staff select an elder, enter or dictate the visit, optionally attach a private reviewed photo, and save once. The formal record is persisted before inline AI analysis. The same page presents the scene, evidence, preference frequency, and follow-up suggestions for one submitter review. Analysis failure leaves the saved record available for retry by its original ID.

Confirmed preferences and recent observations remain distinct. Explicit recurring wording can be confirmed by the submitter as long-term information; ambiguous frequency or a one-time wish remains an observation. A missing observation is never treated as proof that the elder can act independently.

## Handover

Caregivers prepare one editable handover summary in the active handover page. Existing unfinished tasks carry their original IDs into the incoming shift. AI-extracted tasks require one submitter review and complete elder, shift, assignee, due time, and completion criteria before creation. Incomplete suggestions remain uncreated.

Managers and supervisors may inspect handover details. Caregivers see only authorized summaries and tasks. Family members see only reviewed public summaries allowed by their current binding.

## Timeline

The elder timeline groups and sorts events by server registration time. Actual occurrence time is a separate optional value. Filtering and pagination must use registration time, including for backfilled events.

## Safety

Server-side role, elder, admission, revision, and source checks are mandatory. Keep an audit trail for confirmations and task creation. Production migrations must back up the existing store first and preserve accounts and business data.

## Safety incident reporting and direct follow-up

Caregivers and nurses report known facts and immediate measures directly. Administrators and supervisors open urgent notifications to inspect the incident, then choose triage, rectification or review from the incident details. Emergency guidance instructs staff to contact on-site personnel and follow institutional emergency procedures first.

Management sees a persistent red urgent-notification banner with a count and a direct incident link. It refreshes every 30 seconds while the page is visible and on focus. Active incident cards appear ahead of ordinary notifications. Reading a notice keeps the emergency pending until the responsible business step is processed.

Selecting a coverage occurrence opens its review form with the elder, service date, occurrence and fingerprint preserved. The page displays the selected context and asks only for a decision and note. A return action reloads the coverage results for the same elder and date. Selecting a result does not submit a business mutation; writes retain explicit confirmation and concurrency checks.

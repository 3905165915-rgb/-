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

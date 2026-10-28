# Elder Care Workflow Requirements

## Record and Understand

Staff select an elder, enter or dictate the visit, optionally attach a private reviewed photo, and save once. The formal record is persisted before AI analysis. The same page presents observations, personal-impression candidates and follow-up suggestions for one submitter review. Analysis failure leaves the saved record available for retry by its original ID.

Personal impressions become effective only after human confirmation. Frequency wording and the number of supporting days are informational, never barriers to adding an impression. Staff do not choose between long-term and temporary categories in this workflow. Summaries retain explicit time, negation and conditions; source evidence, versions and review history remain available. The default understanding view shows concise personal traits instead of quoted narratives; original words appear in expandable evidence verification. A missing observation is never treated as proof that the elder can act independently.

## Handover

Caregivers prepare one editable handover summary in the active handover page. Existing unfinished tasks carry their original IDs into the incoming shift. AI-extracted tasks require one submitter review and complete elder, shift, assignee, due time, and completion criteria before creation. Incomplete suggestions remain uncreated.

Managers and supervisors may inspect handover details. Caregivers see only authorized summaries and tasks. Family members see only reviewed public summaries allowed by their current binding.

## Timeline

The elder timeline groups and sorts events by server registration time. Actual occurrence time is a separate optional value. Filtering and pagination must use registration time, including for backfilled events.

## Safety

Server-side role, elder, admission, revision, and source checks are mandatory. Keep an audit trail for confirmations and task creation. Production migrations must back up the existing store first and preserve accounts and business data.

import type { Row } from './model'
import type { WorkspaceAttempt } from './workspace-action'
/** A read can settle a lost PUT receipt only for the exact saved actor/body/version. */
export function matchesRuleReceipt(
  row: Row,
  attempt: WorkspaceAttempt,
  userId: string | undefined,
): boolean {
  const body = attempt.body
  if (
    !userId ||
    row.approved_by !== userId ||
    row.revision !== Number(body.expected_revision) + 1 ||
    row.enabled !== body.enabled ||
    row.reason !== body.reason
  )
    return false
  if (attempt.path.endsWith('/plan-automation'))
    return (
      row.plan_id === body.plan_id &&
      row.shift_id === body.shift_id &&
      row.assigned_to === body.assigned_to
    )
  if (
    !attempt.path.endsWith('/automation') ||
    !Array.isArray(row.permitted_actions) ||
    !Array.isArray(body.permitted_actions)
  )
    return false
  return (
    JSON.stringify([...row.permitted_actions].sort()) ===
    JSON.stringify([...body.permitted_actions].sort())
  )
}

import type { Row } from '../../../../packages/shared/src/workflow/model'

const start = (row: Row) => Date.parse(String(row.start_at))
const end = (row: Row) => Date.parse(String(row.end_at))

export function sourceShiftOptions(
  shifts: Row[],
  userId: string,
  role: string,
) {
  return shifts
    .filter(
      (row) =>
        row.status === 'open' &&
        Number.isFinite(start(row)) &&
        Number.isFinite(end(row)) &&
        (['admin', 'supervisor'].includes(role) ||
          (Array.isArray(row.caregiver_ids) &&
            row.caregiver_ids.includes(userId))),
    )
    .sort((a, b) => start(a) - start(b))
}

export function incomingShiftOptions(shifts: Row[], sourceId: string) {
  const source = shifts.find(
    (row) => row.id === sourceId && row.status === 'open',
  )
  if (!source) return []
  return shifts
    .filter(
      (row) =>
        row.status === 'open' &&
        row.id !== sourceId &&
        Number.isFinite(start(row)) &&
        start(row) > start(source),
    )
    .sort((a, b) => start(a) - start(b))
}

export function selectHandoverShifts(
  shifts: Row[],
  userId: string,
  role: string,
  savedSource = '',
  savedTarget = '',
  at = Date.now(),
) {
  const sources = sourceShiftOptions(shifts, userId, role)
  let source = sources.find((row) => row.id === savedSource)
  // A stale draft may point at the latest future shift, with no possible incoming shift.
  if (!source || !incomingShiftOptions(shifts, String(source.id)).length) {
    const viable = sources.filter(
      (row) => incomingShiftOptions(shifts, String(row.id)).length,
    )
    source =
      viable.find((row) => start(row) <= at && at < end(row)) ||
      viable.filter((row) => end(row) <= at).at(-1) ||
      viable[0] ||
      sources[0]
  }
  const targets = incomingShiftOptions(shifts, String(source?.id || ''))
  const target = targets.find((row) => row.id === savedTarget) || targets[0]
  return {
    sourceId: String(source?.id || ''),
    targetId: String(target?.id || ''),
  }
}

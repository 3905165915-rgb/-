import type { Row } from './model'
/** Effectiveness is the backend's decision; a pending observation never substitutes for it. */
export function effectiveAssessment(rows: Row[]): Row | null {
  return rows.find(row => row.status === 'confirmed' &&
    !!row.current && typeof row.current === 'object' &&
    (row.current as Row).effective === true) || null
}

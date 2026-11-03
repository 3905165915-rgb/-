import type { Row } from './model'

export function validateGenerationPreview(value: unknown, path: string, payload: Row): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('任务预览格式异常，请重新读取。')
  const row = value as Row
  const expectedPlan = decodeURIComponent(path.split('/')[2] || '')
  if (row.preview !== true || row.plan_id !== expectedPlan || row.expected_revision !== payload.expected_revision ||
      row.service_date !== payload.service_date || !Array.isArray(row.items) || !Array.isArray(row.existing_task_ids) ||
      !Array.isArray(row.retained_task_ids) || !Array.isArray(row.unassigned_items) || row.timezone !== 'Asia/Shanghai' ||
      row.items.some(item => !item || typeof item !== 'object' || typeof item.title !== 'string' ||
        item.shift_id !== payload.shift_id || item.assigned_to !== payload.assigned_to ||
        !Number.isFinite(Date.parse(String(item.scheduled_at))) || !Number.isFinite(Date.parse(String(item.due_at)))))
    throw new Error('任务预览与当前计划、日期或人员不一致，请重新读取。')
  return row
}
export function generationSignature(path: string, payload: unknown): string {
  return JSON.stringify([path, payload])
}

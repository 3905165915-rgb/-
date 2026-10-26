import type { Row } from './model'
import { object, plainBody, rows } from './workspace-action'
export interface AssessmentOption {
  score: number
  label: string
}
export interface AssessmentItem {
  key: string
  label: string
  options: AssessmentOption[]
}
export interface AssessmentAnswers {
  scores: Record<string, number | null>
  sources: Record<string, Row[]>
  observations: Record<string, string>
  checked: Record<string, boolean>
}
export function blankAnswers(items: AssessmentItem[]): AssessmentAnswers {
  return {
    scores: Object.fromEntries(items.map((item) => [item.key, null])),
    sources: {},
    observations: {},
    checked: {},
  }
}
export function changeAnswer(
  answers: AssessmentAnswers,
  key: string,
  value: number | null,
) {
  if (answers.scores[key] !== value) {
    answers.sources[key] = []
    answers.observations[key] = ''
  }
  answers.scores[key] = value
  answers.checked[key] = false
}
export function applyPrefill(
  answers: AssessmentAnswers,
  value: unknown,
  items: AssessmentItem[],
  elderId: string,
): Record<string, string> {
  const result = object(value)
  if (result.elder_id !== elderId) throw new Error('预填结果与当前老人不匹配。')
  const questions: Record<string, string> = {}
  const seen = new Set<string>()
  const suggestions = rows(result.items)
  for (const row of suggestions) {
    const item = items.find((item) => item.key === row.item_key)
    if (
      !item ||
      seen.has(item.key) ||
      (row.score !== null &&
        !item.options.some((option) => option.score === row.score)) ||
      (row.conflict === true && row.score !== null) ||
      typeof row.question !== 'string'
    )
      throw new Error('预填项目或答案异常，请根据实际观察填写。')
    seen.add(item.key)
    rows(row.citations)
  }
  for (const row of suggestions) {
    const key = String(row.item_key)
    questions[key] = String(row.question)
    if (answers.scores[key] === null || answers.scores[key] === undefined) {
      answers.scores[key] = row.score as number | null
      answers.sources[key] =
        row.score === null ? [] : rows(plainBody({ rows: row.citations }).rows)
      answers.checked[key] = false
    }
  }
  return questions
}
export function checkedAnswers(
  answers: AssessmentAnswers,
  items: AssessmentItem[],
) {
  const selected = items.filter(
    (item) =>
      answers.checked[item.key] &&
      answers.scores[item.key] !== null &&
      answers.scores[item.key] !== undefined,
  )
  for (const item of selected) {
    if (
      !item.options.some((option) => option.score === answers.scores[item.key])
    )
      throw new Error('评估答案不正确。')
    if (
      !answers.sources[item.key]?.length &&
      !answers.observations[item.key]?.trim()
    )
      throw new Error('请为' + item.label + '填写本次观察或核对原文依据。')
  }
  return {
    scores: Object.fromEntries(
      selected.map((item) => [item.key, answers.scores[item.key]]),
    ),
    item_sources: Object.fromEntries(
      selected
        .filter((item) => answers.sources[item.key]?.length)
        .map((item) => [item.key, answers.sources[item.key]]),
    ),
    direct_observations: Object.fromEntries(
      selected
        .filter((item) => answers.observations[item.key]?.trim())
        .map((item) => [item.key, answers.observations[item.key].trim()]),
    ),
  }
}

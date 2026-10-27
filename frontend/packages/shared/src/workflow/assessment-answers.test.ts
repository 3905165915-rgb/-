import { describe, expect, it } from 'vitest'
import {
  applyPrefill,
  blankAnswers,
  changeAnswer,
  checkedAnswers,
  type AssessmentItem,
} from './assessment-answers'
const items: AssessmentItem[] = [
  {
    key: 'feeding',
    label: '进食',
    options: [
      { score: 0, label: '需要帮助' },
      { score: 10, label: '独立完成' },
    ],
  },
  {
    key: 'bathing',
    label: '洗澡',
    options: [
      { score: 0, label: '需要帮助' },
      { score: 5, label: '独立完成' },
    ],
  },
]
const evidence = {
  object_id: 'REC-synthetic',
  object_type: 'care_records',
  revision: 1,
  field: 'observations',
  quote: '虚构：进食需要帮助',
}
const suggestion = {
  elder_id: 'ELDER-test',
  items: [
    {
      item_key: 'feeding',
      score: 0,
      citations: [evidence],
      question: '请核对本次是否需要帮助',
    },
  ],
}
describe('assessment answer evidence', () => {
  it('prefills observed answers without checking them or converting unknown to zero', () => {
    const answers = blankAnswers(items)
    applyPrefill(answers, suggestion, items, 'ELDER-test')
    expect(answers.scores).toEqual({ feeding: 0, bathing: null })
    expect(answers.checked.feeding).toBe(false)
    expect(checkedAnswers(answers, items).scores).toEqual({})
  })
  it('removes citations and confirmation when the user changes the suggested score', () => {
    const answers = blankAnswers(items)
    applyPrefill(answers, suggestion, items, 'ELDER-test')
    answers.checked.feeding = true
    changeAnswer(answers, 'feeding', 10)
    expect(answers.sources.feeding).toEqual([])
    expect(answers.checked.feeding).toBe(false)
    answers.checked.feeding = true
    expect(() => checkedAnswers(answers, items)).toThrow('本次观察')
    answers.observations.feeding = '虚构：本次现场观察可独立用餐'
    const body = checkedAnswers(answers, items)
    expect(body.scores).toEqual({ feeding: 10 })
    expect(body.item_sources).toEqual({})
    expect(body.direct_observations.feeding).toContain('本次现场观察')
  })
  it('keeps evidence assigned to its exact item and leaves other unchecked scores out', () => {
    const answers = blankAnswers(items)
    applyPrefill(answers, suggestion, items, 'ELDER-test')
    answers.checked.feeding = true
    answers.scores.bathing = 5
    const result = checkedAnswers(answers, items)
    expect(result.scores).toEqual({ feeding: 0 })
    expect(result.item_sources).toEqual({ feeding: [evidence] })
    expect(result.item_sources).not.toHaveProperty('bathing')
  })
  it('does not replace a saved answer with citations for a different prefill suggestion', () => {
    const answers = blankAnswers(items)
    answers.scores.feeding = 10
    answers.observations.feeding = '虚构现场观察'
    applyPrefill(answers, suggestion, items, 'ELDER-test')
    expect(answers.scores.feeding).toBe(10)
    expect(answers.sources.feeding).toBeUndefined()
    expect(answers.observations.feeding).toBe('虚构现场观察')
  })
  it('rejects wrong elders, duplicate keys and invalid scores before mutating any answers', () => {
    for (const value of [
      { ...suggestion, elder_id: 'OTHER' },
      { ...suggestion, items: [...suggestion.items, ...suggestion.items] },
      { ...suggestion, items: [{ ...suggestion.items[0], score: 999 }] },
    ]) {
      const answers = blankAnswers(items)
      expect(() => applyPrefill(answers, value, items, 'ELDER-test')).toThrow()
      expect(answers.scores.feeding).toBeNull()
    }
  })
  it('keeps conflict citations out of any selected answer and requires new observation', () => {
    const answers = blankAnswers(items)
    applyPrefill(
      answers,
      {
        elder_id: 'ELDER-test',
        items: [
          {
            ...suggestion.items[0],
            conflict: true,
            score: null,
            citations: [
              evidence,
              {
                ...evidence,
                object_id: 'REC-other',
                quote: '虚构：另一记录表示独立进食',
              },
            ],
          },
        ],
      },
      items,
      'ELDER-test',
    )
    expect(answers.scores.feeding).toBeNull()
    expect(answers.sources.feeding).toEqual([])
    changeAnswer(answers, 'feeding', 10)
    answers.checked.feeding = true
    expect(() => checkedAnswers(answers, items)).toThrow('本次观察')
  })
})

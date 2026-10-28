import { describe, expect, it } from 'vitest'
import { personalFeature, personalFeatures } from './personal-profile'

describe('personal impression presentation', () => {
  it('keeps newly approved features beyond the first five and removes duplicate presentation lines', () => {
    const rows = [
      '喜欢喝茶',
      '喜欢下棋',
      '喜欢散步',
      '喜欢听戏',
      '喜欢聊天',
      '喜欢太极',
      '喜欢喝茶',
    ].map((display_summary) => ({ display_summary }))
    expect(personalFeatures(rows)).toEqual([
      '喜欢喝茶',
      '喜欢下棋',
      '喜欢散步',
      '喜欢听戏',
      '喜欢聊天',
      '喜欢太极',
    ])
  })
  it('shows the server summary instead of the original spoken narrative', () => {
    expect(
      personalFeature({
        display_summary: '喜欢低音量京剧，活动前先询问',
        content: '王爷爷说：“我一直喜欢听低音量的京剧。”',
      }),
    ).toBe('喜欢低音量京剧，活动前先询问')
  })
  it('makes an older quoted memory readable without deleting the original source', () => {
    const row = {
      content: '王爷爷说：“我喜欢喝茶。”',
      source: { quote: '我喜欢喝茶' },
    }
    expect(personalFeature(row)).toBe('喜欢喝茶')
    expect(row.source.quote).toBe('我喜欢喝茶')
  })
  it('preserves negation, context and time without inventing a permanent trait', () => {
    expect(
      personalFeature({ content: '本人说：“我今天不喜欢参加活动。”' }),
    ).toBe('今天不喜欢参加活动')
    expect(
      personalFeature({ text: '本人说：“不喜欢声音太大，午休后再询问。”' }),
    ).toBe('不喜欢声音太大，午休后再询问')
  })
})

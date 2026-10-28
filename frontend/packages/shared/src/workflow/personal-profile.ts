import type { Row } from './model'

/** Legacy fallback while the server prepares a concise presentation summary. */
export function personalFeature(row: Row): string {
  return String(row.display_summary || row.content || row.text || '')
    .trim()
    .replace(/^[\u4e00-\u9fff]{1,16}?(?:说|表示|提到|补充)[：:]\s*/, '')
    .replace(/^[“”「」"']+|[“”「」"'。\s]+$/g, '')
    .replace(
      /^(?:我|本人)(?=一直|每天|每日|每周|经常|今天|这次|本次|现在|暂时|喜欢|不喜欢|习惯|愿意|不愿)/,
      '',
    )
    .trim()
}

export function personalFeatures(rows: Row[]): string[] {
  return [...new Set(rows.map(personalFeature).filter(Boolean))]
}

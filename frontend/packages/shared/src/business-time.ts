const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
function parts(value: string | number | Date) {
  // Absolute timestamps without an offset have no reliable business meaning.
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value)
    if (!match) return null
    const [, y, m, d, h, min, sec = '0', offset] = match
    const calendar = new Date(0)
    calendar.setUTCFullYear(Number(y), Number(m) - 1, Number(d))
    if (calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() !== Number(m) - 1 || calendar.getUTCDate() !== Number(d) || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null
    if (offset.toUpperCase() !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null
  }
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return null
  const fields = formatter.formatToParts(date)
  const get = (name: Intl.DateTimeFormatPartTypes) => fields.find(p => p.type === name)?.value || ''
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}
export function businessDay(value: string | number | Date = Date.now()): string {
  const target = parts(value)
  return target ? `${target.year}-${target.month.padStart(2, '0')}-${target.day.padStart(2, '0')}` : ''
}
export function formatBusinessTime(value: string | number | Date, full = false) {
  const target = parts(value)
  if (!target) return '时间待核实'
  const clock = `${target.hour}:${target.minute}`
  if (!full && businessDay(value) === businessDay()) return `今天${clock}`
  if (!full) return `${target.month}月${target.day}日${clock}`
  return `${target.year}年${target.month}月${target.day}日 ${clock}`
}
export function isBusinessToday(value: string | number | Date) {
  const day = businessDay(value)
  return !!day && day === businessDay()
}

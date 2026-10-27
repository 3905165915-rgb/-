import { businessDay } from '../business-time'
/** datetime-local values are explicitly Beijing time, independent of the device zone. */
export function localTime(value: Date) {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, -1)
}

export function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value))
    throw new Error('请填写有效的北京时间。')
  const result = new Date(value + (value.length === 16 ? ':00' : '') + '+08:00')
  if (
    !Number.isFinite(result.valueOf()) ||
    !businessDay(value + (value.length === 16 ? ':00' : '') + '+08:00')
  )
    throw new Error('请填写有效的北京时间。')
  return result.toISOString()
}

export interface CalendarDay { value: string; day: number; current: boolean }
export const twoDigits = (value: number) => String(value).padStart(2, '0')
export function dateValue(year: number, month: number, day: number) {
  return `${year}-${twoDigits(month)}-${twoDigits(day)}`
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const stamp = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && year <= 9999 && stamp.getUTCFullYear() === year && stamp.getUTCMonth() === month - 1 && stamp.getUTCDate() === day
}
export function monthDays(year: number, month: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(Date.UTC(year, month - 1, 1 - mondayOffset + index))
    return { value: dateValue(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()), day: day.getUTCDate(), current: day.getUTCMonth() + 1 === month }
  })
}
export function beijingNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date())
  return parts.replace(' ', 'T')
}

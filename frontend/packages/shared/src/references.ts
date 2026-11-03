/** Return a stable, compact label for an internal reference shown in the UI. */
export function compactReference(value: string | undefined | null) {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length <= 18) return normalized
  const separator = normalized.indexOf('-')
  if (separator > 0) {
    const prefix = normalized.slice(0, separator)
    const token = normalized.slice(separator + 1).replace(/[^a-z0-9]/gi, '')
    if (prefix && token) return `${prefix}-${token.slice(0, 4).toUpperCase()}`
  }
  return normalized.slice(0, 14)
}

const transparencyKey = 'hulao.ui.reduce-transparency'

export function getReducedTransparency(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(transparencyKey) === 'true'
    )
  } catch {
    return false
  }
}

function applyTransparency(value: boolean): void {
  if (typeof document !== 'undefined')
    document.documentElement.dataset.reduceTransparency = String(value)
}

export function applyUiPreferences(): void {
  applyTransparency(getReducedTransparency())
}

export function setReducedTransparency(value: boolean): boolean {
  applyTransparency(value)
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(transparencyKey, String(value))
    return true
  } catch {
    return false
  }
}

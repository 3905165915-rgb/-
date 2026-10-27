const batchKey = 'hulao:demo-batch'
export function demoBatch(): string {
  try { return localStorage.getItem(batchKey) || '' } catch { return '' }
}
export function acceptDemoBatch(next: string | null | undefined) {
  if (!next) return
  const previous = demoBatch()
  if (previous === next) return
  const loginKey = 'hulao:session:v2'
  try {
    const initialLogin = !previous ? sessionStorage.getItem(loginKey) : null
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store))
        if (/^(hulao[:.-]|hulao$)/.test(key)) store.removeItem(key)
    }
    localStorage.setItem(batchKey, next)
    if (!previous) {
      if (initialLogin) sessionStorage.setItem(loginKey, initialLogin)
      return
    }
  } catch {
    throw new Error('浏览器无法清理旧演示草稿。请允许网站存储后重新打开。')
  }
  window.dispatchEvent(new Event('hulao:unauthorized'))
  setTimeout(() => window.location.reload(), 0)
  throw new Error('演示资料已更新，已清理旧草稿与选择，正在重新载入。')
}

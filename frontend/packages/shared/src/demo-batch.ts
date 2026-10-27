const batchKey = 'hulao:demo-batch'
export function demoBatch(): string {
  try {
    return localStorage.getItem(batchKey) || ''
  } catch {
    return ''
  }
}
function isLocalDemo(key: string, value: string | null) {
  if (key.includes('"demo"')) return true
  try {
    return value !== null && JSON.parse(value)?.mode === 'demo'
  } catch {
    return false
  }
}
export function acceptDemoBatch(next: string | null | undefined) {
  if (!next) return
  const previous = demoBatch()
  if (previous === next) return
  const loginKey = 'hulao:session:v2'
  try {
    const initialLogin = !previous ? sessionStorage.getItem(loginKey) : null
    const snapshots = [localStorage, sessionStorage].map((store) => ({
      store,
      entries: Object.keys(store)
        .filter(
          (key) =>
            /^(hulao[:.-]|hulao$)/.test(key) &&
            key !== batchKey &&
            !isLocalDemo(key, store.getItem(key)),
        )
        .map((key) => [key, store.getItem(key)] as const),
    }))
    // Archive each storage in place before removing any active keys. In particular,
    // session-only credentials must never be copied into localStorage.
    const archiveKey =
      'care:server-batch-archive:' +
      encodeURIComponent(previous || 'initial') +
      ':' +
      Date.now()
    for (const { store, entries } of snapshots)
      if (entries.length) store.setItem(archiveKey, JSON.stringify(entries))
    for (const { store, entries } of snapshots)
      for (const [key] of entries) store.removeItem(key)
    localStorage.setItem(batchKey, next)
    if (!previous) {
      if (initialLogin) sessionStorage.setItem(loginKey, initialLogin)
      return
    }
  } catch {
    throw new Error(
      '浏览器无法归档并隔离旧演示草稿。请允许网站存储后重新打开。',
    )
  }
  window.dispatchEvent(new Event('hulao:unauthorized'))
  setTimeout(() => window.location.reload(), 0)
  throw new Error('演示资料已更新，已归档旧草稿与选择，正在重新载入。')
}

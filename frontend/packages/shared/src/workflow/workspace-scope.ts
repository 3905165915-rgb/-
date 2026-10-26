import { onBeforeUnmount, onMounted, ref } from 'vue'
import { readSession } from '../session'
import { sameCareSession } from './task-care-context'
import { staffSession } from './workspace-action'
/** Clearing scope removes rendered staff data as well as blocking late responses. */
export function useWorkspaceScope() {
  const owner = readSession()
  const active = ref(!!staffSession(owner))
  const management = owner?.role === 'admin' || owner?.role === 'supervisor'
  function check() {
    if (!sameCareSession(readSession(), owner) || !staffSession(readSession()))
      active.value = false
  }
  function revoke() {
    active.value = false
  }
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    window.addEventListener('storage', check)
    window.addEventListener('focus', check)
    window.addEventListener('hulao:unauthorized', revoke)
    timer = setInterval(check, 1000)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    window.removeEventListener('storage', check)
    window.removeEventListener('focus', check)
    window.removeEventListener('hulao:unauthorized', revoke)
  })
  return {
    owner,
    active,
    management,
    revoke,
    valid: () => {
      check()
      return active.value
    },
  }
}

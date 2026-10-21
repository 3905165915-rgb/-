import { computed, onMounted, onScopeDispose, ref } from 'vue'

export function useMobileViewport() {
  const keyboardOffset = ref(0)
  function update() {
    const viewport = window.visualViewport
    const obscured = viewport
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0
    const editing = document.activeElement?.matches('input, textarea, select')
    keyboardOffset.value = editing && obscured > 120 ? obscured : 0
  }
  onMounted(() => {
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    update()
  })
  onScopeDispose(() => {
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
  })
  return {
    keyboardOffset,
    keyboardOpen: computed(() => keyboardOffset.value > 0),
  }
}

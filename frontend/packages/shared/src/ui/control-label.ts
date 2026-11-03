import { onMounted, onUpdated, ref, type Ref } from 'vue'

/** Keep the visible field label attached to the actual interactive trigger. */
export function useControlLabel(trigger: Ref<HTMLButtonElement | undefined>, attrs: Record<string, unknown>, fallback: () => string) {
  const visibleLabel = ref('')
  function sync() {
    const label = trigger.value?.labels?.[0] || trigger.value?.closest('label')
    if (!label) return
    const copy = label.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.care-select, .care-datetime, .wf-field-error, input, textarea, button, [role="alert"]').forEach(node => node.remove())
    const text = copy.textContent?.replace(/\s+/g, ' ').trim() || ''
    if (visibleLabel.value !== text) visibleLabel.value = text
  }
  onMounted(sync)
  onUpdated(sync)
  return () => attrs['aria-labelledby'] ? undefined : String(attrs['aria-label'] || visibleLabel.value || fallback())
}

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, useSlots, watch } from 'vue'
import { controlEvent, selectOptions } from './select-options'
import type { CareOption } from './select-options'
import { readSession } from '../session'
import type { FrontendSession } from '../session'
import { sameCareSession } from '../workflow/task-care-context'
import { request } from '../workflow/model'
import { createRemoteOptions, optionLabel, type OptionKind, type OptionScope } from './remote-options'
import { useControlLabel } from './control-label'
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue?: unknown
  value?: unknown
  modelModifiers?: { number?: boolean; trim?: boolean }
  disabled?: boolean
  required?: boolean
  multiple?: boolean
  name?: string
  optionKind?: OptionKind
  scope?: OptionScope
}>()
const emit = defineEmits<{
  'update:modelValue': [unknown]
  change: [Event]
  input: [Event]
  blur: [FocusEvent]
  'option-selected': [Record<string, unknown>]
}>()
const attrs = useAttrs(), slots = useSlots(), id = useId()
const trigger = ref<HTMLButtonElement>(), searchInput = ref<HTMLInputElement>()
const opened = ref(false), search = ref(''), active = ref(-1)
const position = ref<Record<string, string>>({})
const remoteActive = ref(false), searchPending = ref(false), selectedOptions = ref<CareOption[]>([])
const remote = createRemoteOptions({ request, session: readSession })
const remoteState = remote.state
let remoteSession: FrontendSession | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined
let sessionTimer: ReturnType<typeof setInterval> | undefined
const selected = computed(() => props.modelValue !== undefined ? props.modelValue : props.value)
const options = computed(() => selectOptions(slots.default?.() || []))
const filtered = computed(() => remoteActive.value
  ? [...(!search.value ? options.value.filter(option => option.value === '') : []), ...remoteState.value.items.map(row => ({ value: row.id, label: optionLabel(row, props.optionKind!), disabled: false, row }))]
  : options.value.filter(option => option.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const isSelected = (value: unknown) => props.multiple
  ? Array.isArray(selected.value) && selected.value.some(item => Object.is(item, value) || String(item) === String(value))
  : Object.is(selected.value, value) || String(selected.value ?? '') === String(value ?? '')
const title = computed(() => {
  const available = new Map([...options.value, ...selectedOptions.value].map(option => [String(option.value), option]))
  return [...available.values()].filter(option => isSelected(option.value)).map(option => option.label).join('、') || '请选择'
})
const activeId = computed(() => active.value >= 0 ? `${id}-option-${active.value}` : undefined)
const accessibleLabel = useControlLabel(trigger, attrs, () => title.value)
function locate() {
  const box = trigger.value?.getBoundingClientRect()
  if (!box) return
  const width = Math.min(Math.max(box.width, 280), window.innerWidth - 24)
  const availableBelow = window.innerHeight - box.bottom - 16
  const above = availableBelow < 300 && box.top > Math.max(260, availableBelow)
  const availableHeight = Math.max(120, above ? box.top - 18 : availableBelow)
  position.value = {
    width: `${width}px`,
    maxHeight: `${availableHeight}px`,
    left: `${Math.min(Math.max(12, box.left), window.innerWidth - width - 12)}px`,
    ...(above ? { bottom: `${window.innerHeight - box.top + 6}px` } : { top: `${box.bottom + 6}px` }),
  }
}
async function open() {
  if (props.disabled || trigger.value?.matches(':disabled') || opened.value) return
  opened.value = true
  search.value = ''
  const currentSession = readSession()
  if (remoteSession && !sameCareSession(remoteSession, currentSession)) selectedOptions.value = []
  remoteSession = currentSession
  remoteActive.value = !!props.optionKind && remoteSession?.mode === 'api'
  if (remoteActive.value) {
    void loadRemote()
    sessionTimer = setInterval(() => {
      if (!sameCareSession(remoteSession, readSession())) { selectedOptions.value = []; remote.reset(); close(false) }
    }, 1000)
  }
  locate()
  active.value = Math.max(0, filtered.value.findIndex(option => isSelected(option.value) && !option.disabled))
  await nextTick()
  searchInput.value?.focus()
}
function close(restore = true) {
  opened.value = false
  remoteActive.value = false
  clearTimeout(searchTimer)
  searchPending.value = false
  clearInterval(sessionTimer)
  remote.reset()
  if (restore) trigger.value?.focus()
}
function choose(index: number) {
  if (props.disabled || trigger.value?.matches(':disabled')) { close(false); return }
  if (remoteActive.value && !sameCareSession(remoteSession, readSession())) { selectedOptions.value = []; close(false); return }
  const option = filtered.value[index]
  if (!option || option.disabled) return
  let value = option.value
  if (props.modelModifiers?.number && typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) value = Number(value)
  if (props.modelModifiers?.trim && typeof value === 'string') value = value.trim()
  if (props.multiple) {
    const existing = Array.isArray(selected.value) ? selected.value : []
    value = isSelected(option.value) ? existing.filter(item => String(item) !== String(option.value)) : [...existing, value]
  }
  emit('update:modelValue', value)
  if (option.row) {
    selectedOptions.value = props.multiple ? [...selectedOptions.value.filter(item => String(item.value) !== String(option.value)), option] : [option]
    emit('option-selected', option.row)
  }
  emit('input', controlEvent(value, 'input'))
  emit('change', controlEvent(value, 'change'))
  if (!props.multiple) close()
}
function move(step: number) {
  if (!filtered.value.length) { active.value = -1; return }
  for (let attempt = 0, index = active.value; attempt < filtered.value.length; attempt++) {
    index = (index + step + filtered.value.length) % filtered.value.length
    if (!filtered.value[index].disabled) {
      active.value = index
      void nextTick(() => document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' }))
      return
    }
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!opened.value) void open()
    else move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (opened.value && event.key === 'Enter') { event.preventDefault(); choose(active.value) }
  else if (opened.value && event.key === 'Tab') close(false)
}
async function loadRemote() {
  if (!props.optionKind || !remoteActive.value || !opened.value) return
  searchPending.value = false
  await remote.load(props.optionKind, search.value, props.scope)
  active.value = filtered.value.findIndex(option => !option.disabled)
}
watch(search, () => {
  active.value = filtered.value.findIndex(option => !option.disabled)
  if (remoteActive.value && opened.value) {
    clearTimeout(searchTimer)
    remote.reset()
    searchPending.value = true
    searchTimer = setTimeout(() => { void loadRemote() }, 250)
  }
}, { flush: 'sync' })
watch(() => [props.optionKind, props.scope], () => {
  if (!props.optionKind) { remoteActive.value = false; remote.reset() }
  else if (opened.value && remoteActive.value) { clearTimeout(searchTimer); void loadRemote() }
}, { deep: true })
watch(() => props.disabled, value => { if (value) close(false) })
function viewportChanged() { if (opened.value) locate() }
onMounted(() => { window.addEventListener('resize', viewportChanged); window.addEventListener('scroll', viewportChanged, true) })
onBeforeUnmount(() => { clearTimeout(searchTimer); clearInterval(sessionTimer); remote.reset(); window.removeEventListener('resize', viewportChanged); window.removeEventListener('scroll', viewportChanged, true) })
</script>
<template>
  <span class="care-select">
    <button
      ref="trigger"
      v-bind="attrs"
      type="button"
      class="care-select-trigger"
      :aria-label="accessibleLabel()"
      role="combobox"
      :disabled="disabled"
      :aria-required="required || undefined"
      aria-haspopup="listbox"
      :aria-expanded="opened"
      :aria-controls="id + '-list'"
      @click="opened ? close() : open()"
      @keydown="keyboard"
      @blur="emit('blur', $event)"
    >
      <span>{{ title }}</span><span aria-hidden="true">⌄</span>
    </button>
    <input
      class="care-control-proxy"
      tabindex="-1"
      aria-hidden="true"
      :value="selected == null ? '' : String(selected)"
      :required="required"
      :disabled="disabled"
      :name="name"
      @focus="open"
      @invalid="open"
    >
    <Teleport to="body">
      <div
        v-if="opened"
        class="care-picker-backdrop"
        @mousedown.self="close()"
        @click.self="close()"
      >
        <section
          class="care-select-popup"
          :style="position"
          :aria-label="String(attrs['aria-label'] || '选择选项')"
          @keydown="keyboard"
        >
          <div class="care-picker-heading"><strong>选择选项</strong><button
            type="button"
            aria-label="关闭选项"
            @click="close()"
          >关闭</button></div>
          <input
            ref="searchInput"
            v-model="search"
            class="care-select-search"
            type="search"
            placeholder="输入姓名、内容或日期搜索"
            aria-label="搜索选项"
            role="combobox"
            :aria-controls="id + '-list'"
            :aria-activedescendant="activeId"
            aria-expanded="true"
            autocomplete="off"
            maxlength="100"
          >
          <ul
            :id="id + '-list'"
            class="care-select-options"
            role="listbox"
            :aria-multiselectable="multiple || undefined"
            :aria-busy="remoteActive && (remoteState.loading || searchPending) || undefined"
          >
            <li
              v-for="(option, index) in filtered"
              :id="`${id}-option-${index}`"
              :key="index"
              role="option"
              :aria-selected="isSelected(option.value)"
              :aria-disabled="option.disabled || undefined"
              :class="{ active: index === active, selected: isSelected(option.value), disabled: option.disabled }"
              @mousedown.prevent
              @click="choose(index)"
              @mousemove="active = index"
            ><span>{{ option.label }}</span><span
              v-if="isSelected(option.value)"
              aria-hidden="true"
            >✓</span></li>
          </ul>
          <p
            v-if="remoteActive && (remoteState.loading || searchPending)"
            class="care-picker-empty"
            role="status"
          >正在读取选项…</p>
          <div
            v-if="remoteActive && remoteState.error"
            class="care-picker-error"
            role="alert"
          ><p>{{ remoteState.error }}</p><button
            type="button"
            class="care-picker-confirm"
            @click="loadRemote"
          >重新读取</button></div>
          <button
            v-if="remoteActive && !remoteState.error && remoteState.items.length < remoteState.total"
            type="button"
            class="care-picker-confirm"
            :disabled="remoteState.loading || searchPending"
            @click="remote.more"
          >加载更多（{{ remoteState.items.length }} / {{ remoteState.total }}）</button>
          <p
            v-if="!filtered.length && (!remoteActive || !remoteState.loading && !searchPending && !remoteState.error)"
            class="care-picker-empty"
            role="status"
          >没有匹配的选项，请换个关键词。</p>
          <button
            v-if="multiple"
            class="care-picker-confirm"
            type="button"
            @click="close()"
          >完成选择</button>
        </section>
      </div>
    </Teleport>
  </span>
</template>

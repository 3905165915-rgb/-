<script setup lang="ts">
import { computed, nextTick, ref, useAttrs, useId } from 'vue'
import { beijingNow, dateValue, monthDays, twoDigits, validDate } from './calendar'
import { controlEvent } from './select-options'
import { useControlLabel } from './control-label'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  modelValue?: unknown
  value?: unknown
  type?: 'date' | 'time' | 'datetime-local'
  disabled?: boolean
  readonly?: boolean
  required?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
  name?: string
}>(), { type: 'date', modelValue: undefined, value: undefined, min: undefined, max: undefined, step: undefined, name: undefined })
const emit = defineEmits<{ 'update:modelValue': [string]; input: [Event]; change: [Event]; blur: [FocusEvent] }>()
const attrs = useAttrs(), id = useId()
const trigger = ref<HTMLButtonElement>(), popup = ref<HTMLElement>()
const opened = ref(false), picked = ref(''), year = ref(2026), month = ref(1)
const hour = ref(0), minute = ref(0), second = ref(0), error = ref('')
const choosingMonth = ref(false), jumpYear = ref(2026), jumpMonth = ref(1)
const selected = computed(() => String(props.modelValue ?? props.value ?? ''))
const hasDate = computed(() => props.type !== 'time')
const hasTime = computed(() => props.type !== 'date')
const hasSeconds = computed(() => Number(props.step) > 0 && Number(props.step) < 60 || selected.value.split('T').at(-1)?.split(':').length === 3)
const title = computed(() => !selected.value ? hasDate.value ? '请选择日期' : '请选择时间' : selected.value.replace('T', ' ').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1年$2月$3日'))
const accessibleLabel = useControlLabel(trigger, attrs, () => title.value)
const days = computed(() => monthDays(year.value, month.value))
const dayLabel = (value: string) => `${Number(value.slice(0, 4))}年${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`
const draft = computed(() => {
  const clock = `${twoDigits(hour.value)}:${twoDigits(minute.value)}${hasSeconds.value ? ':' + twoDigits(second.value) : ''}`
  return props.type === 'date' ? picked.value : props.type === 'time' ? clock : `${picked.value}T${clock}`
})
function dayDisabled(value: string) {
  return props.min !== undefined && value < String(props.min).slice(0, 10) || props.max !== undefined && value > String(props.max).slice(0, 10)
}
async function open() {
  if (props.disabled || props.readonly || trigger.value?.matches(':disabled')) return
  const now = beijingNow()
  const parts = (hasDate.value ? selected.value || now : now).slice(0, 10).split('-').map(Number)
  year.value = parts[0]; month.value = parts[1]
  jumpYear.value = parts[0]; jumpMonth.value = parts[1]; choosingMonth.value = false
  picked.value = dateValue(parts[0], parts[1], parts[2])
  const clock = (props.type === 'time' ? selected.value : selected.value.split('T')[1]) || now.slice(11)
  const times = clock.split(':').map(Number)
  hour.value = times[0] || 0; minute.value = times[1] || 0; second.value = times[2] || 0
  error.value = ''; opened.value = true
  await nextTick()
  popup.value?.querySelector<HTMLButtonElement | HTMLInputElement>('[aria-pressed="true"], input, button')?.focus()
}
function close() { opened.value = false; trigger.value?.focus() }
function shiftMonth(delta: number) {
  const next = new Date(Date.UTC(year.value, month.value - 1 + delta, 1))
  if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 9999) return
  year.value = next.getUTCFullYear(); month.value = next.getUTCMonth() + 1
  jumpYear.value = year.value; jumpMonth.value = month.value
}
function jumpToMonth() {
  if (!Number.isInteger(jumpYear.value) || jumpYear.value < 1900 || jumpYear.value > 9999 || !Number.isInteger(jumpMonth.value) || jumpMonth.value < 1 || jumpMonth.value > 12) { error.value = '年份应为1900至9999，月份应为1至12。'; return }
  year.value = jumpYear.value; month.value = jumpMonth.value; choosingMonth.value = false; error.value = ''
}
function pick(value: string) {
  if (dayDisabled(value)) return
  picked.value = value
  year.value = Number(value.slice(0, 4)); month.value = Number(value.slice(5, 7))
}
function publish(value: string) {
  if (props.disabled || props.readonly || trigger.value?.matches(':disabled')) { close(); return }
  emit('update:modelValue', value)
  emit('input', controlEvent(value, 'input'))
  emit('change', controlEvent(value, 'change'))
  close()
}
function apply() {
  error.value = ''
  if (hasDate.value && !validDate(picked.value)) { error.value = '请选择有效日期。'; return }
  if (hasTime.value && (![hour.value, minute.value, second.value].every(Number.isInteger) || hour.value < 0 || hour.value > 23 || minute.value < 0 || minute.value > 59 || second.value < 0 || second.value > 59)) { error.value = '小时应为0至23，分钟和秒应为0至59。'; return }
  if (props.min !== undefined && draft.value < String(props.min) || props.max !== undefined && draft.value > String(props.max)) { error.value = '所选时间超出允许范围，请重新选择。'; return }
  publish(draft.value)
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key === 'Tab') {
    const focusable = popup.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
}
function dayKey(event: KeyboardEvent, value: string) {
  const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (!(event.key in delta)) return
  event.preventDefault()
  const day = new Date(value + 'T00:00:00Z')
  day.setUTCDate(day.getUTCDate() + delta[event.key])
  const next = dateValue(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate())
  pick(next)
  void nextTick(() => popup.value?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus())
}
function today() {
  const now = beijingNow()
  pick(now.slice(0, 10)); hour.value = Number(now.slice(11, 13)); minute.value = Number(now.slice(14, 16)); second.value = Number(now.slice(17, 19))
}
</script>
<template>
  <span class="care-datetime">
    <button
      ref="trigger"
      v-bind="attrs"
      type="button"
      class="care-date-trigger"
      :aria-label="accessibleLabel()"
      :disabled="disabled"
      :aria-readonly="readonly || undefined"
      :aria-required="required || undefined"
      aria-haspopup="dialog"
      :aria-expanded="opened"
      :aria-controls="id + '-calendar'"
      @click="open"
      @blur="emit('blur', $event)"
    ><span>{{ title }}</span><span aria-hidden="true">▦</span></button>
    <input
      class="care-control-proxy"
      tabindex="-1"
      aria-hidden="true"
      :value="selected"
      :required="required"
      :disabled="disabled"
      :name="name"
      @focus="open"
      @invalid="open"
    >
    <Teleport to="body">
      <div
        v-if="opened"
        class="care-calendar-backdrop"
        @mousedown.self="close()"
        @click.self="close()"
      >
        <section
          :id="id + '-calendar'"
          ref="popup"
          class="care-calendar-popup"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="id + '-heading'"
          @keydown="keyboard"
        >
          <div class="care-picker-heading"><strong :id="id + '-heading'">{{ type === 'date' ? '选择日期' : type === 'time' ? '选择时间' : '选择日期和时间' }}</strong><button
            type="button"
            aria-label="关闭日期选择"
            @click="close()"
          >关闭</button></div>
          <p class="care-picker-zone">北京时间</p>
          <template v-if="hasDate">
            <div class="care-calendar-navigation"><button
              type="button"
              aria-label="上一年"
              @click="shiftMonth(-12)"
            >«</button><button
              type="button"
              aria-label="上个月"
              @click="shiftMonth(-1)"
            >‹</button><button
              type="button"
              class="care-calendar-month"
              aria-label="选择年月"
              :aria-expanded="choosingMonth"
              @click="choosingMonth = !choosingMonth"
            >{{ year }}年{{ month }}月</button><button
              type="button"
              aria-label="下个月"
              @click="shiftMonth(1)"
            >›</button><button
              type="button"
              aria-label="下一年"
              @click="shiftMonth(12)"
            >»</button></div>
            <div
              v-if="choosingMonth"
              class="care-month-jump"
            ><label>年份<input
              v-model.number="jumpYear"
              type="number"
              min="1900"
              max="9999"
              inputmode="numeric"
            ></label><label>月份<input
              v-model.number="jumpMonth"
              type="number"
              min="1"
              max="12"
              inputmode="numeric"
            ></label><button
              type="button"
              @click="jumpToMonth"
            >转到该月</button></div>
            <div class="care-calendar-week"><span
              v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']"
              :key="weekday"
            >{{ weekday }}</span></div>
            <div
              class="care-calendar-days"
              aria-label="日期"
            >
              <button
                v-for="day in days"
                :key="day.value"
                type="button"
                :data-day="day.value"
                :aria-label="dayLabel(day.value)"
                :aria-pressed="picked === day.value"
                :disabled="dayDisabled(day.value)"
                :class="{ outside: !day.current, selected: picked === day.value }"
                @click="pick(day.value)"
                @keydown="dayKey($event, day.value)"
              >{{ day.day }}</button>
            </div>
          </template>
          <div
            v-if="hasTime"
            class="care-clock"
          ><label>小时<input
            v-model.number="hour"
            type="number"
            min="0"
            max="23"
            inputmode="numeric"
          ></label><span>:</span><label>分钟<input
            v-model.number="minute"
            type="number"
            min="0"
            max="59"
            inputmode="numeric"
          ></label><template v-if="hasSeconds"><span>:</span><label>秒<input
            v-model.number="second"
            type="number"
            min="0"
            max="59"
            inputmode="numeric"
          ></label></template></div>
          <p
            v-if="error"
            role="alert"
            class="care-picker-error"
          >{{ error }}</p>
          <div class="care-calendar-actions"><button
            type="button"
            @click="today"
          >{{ hasTime ? '现在' : '今天' }}</button><button
            v-if="!required"
            type="button"
            @click="publish('')"
          >清空</button><button
            type="button"
            class="care-picker-confirm"
            @click="apply"
          >确认</button></div>
        </section>
      </div>
    </Teleport>
  </span>
</template>

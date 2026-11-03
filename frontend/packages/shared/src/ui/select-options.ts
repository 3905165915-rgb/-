import { isVNode, type VNode } from 'vue'

export interface CareOption { value: unknown; label: string; disabled: boolean; row?: Record<string, unknown> }

function text(children: unknown): string {
  if (Array.isArray(children)) return children.map(text).join('')
  if (isVNode(children)) return text(children.children)
  return typeof children === 'string' || typeof children === 'number' ? String(children) : ''
}

/** Read option VNodes without rendering a native select or losing bound value types. */
export function selectOptions(nodes: unknown, inheritedDisabled = false): CareOption[] {
  if (Array.isArray(nodes)) return nodes.flatMap(node => selectOptions(node, inheritedDisabled))
  if (!isVNode(nodes)) return []
  const node = nodes as VNode
  const disabled = inheritedDisabled || node.props?.disabled === '' || node.props?.disabled === true
  if (node.type === 'option') {
    const label = text(node.children).replace(/\s+/g, ' ').trim()
    return [{ value: node.props && 'value' in node.props ? node.props.value : label, label, disabled }]
  }
  return selectOptions(node.children, disabled)
}

export function controlEvent(value: unknown, type: 'input' | 'change'): Event {
  const event = new Event(type, { bubbles: true })
  const target = { value, checked: !!value }
  Object.defineProperty(event, 'target', { value: target })
  Object.defineProperty(event, 'currentTarget', { value: target })
  return event
}

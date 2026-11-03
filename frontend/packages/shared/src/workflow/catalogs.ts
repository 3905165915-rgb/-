import contract from './contract.json'
import type { Row, Schema } from './model'

function invalid(path: string): never { throw new Error(`接口目录格式不匹配（${path}），请刷新或联系管理员，异常数据未载入。`) }
const schemas = contract.schemas as Record<string, Schema>
export function checkResponse(schema: Schema, value: unknown, path = '$'): void {
  if (schema.$ref) return checkResponse(schemas[schema.$ref.split('/').pop()!] || {}, value, path)
  if (schema.anyOf) {
    for (const branch of schema.anyOf) {
      try { checkResponse(branch, value, path); return } catch { /* Try the other declared wire shape. */ }
    }
    invalid(path)
  }
  if (schema.type === 'null') { if (value !== null) invalid(path); return }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path)
    const row = value as Row
    for (const key of schema.required || []) if (!Object.hasOwn(row, key)) invalid(path + '.' + key)
    for (const [key, child] of Object.entries(schema.properties || {}))
      if (Object.hasOwn(row, key)) checkResponse(child, row[key], path + '.' + key)
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems || 0) || (schema.maxItems !== undefined && value.length > schema.maxItems)) invalid(path)
    value.forEach((child, index) => checkResponse(schema.items || {}, child, `${path}[${index}]`))
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength || 0) || (schema.maxLength !== undefined && value.length > schema.maxLength)) invalid(path)
    if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !Number.isFinite(Date.parse(value)))) invalid(path)
    if (schema.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid(path)
  }
  if (schema.type === 'integer' || schema.type === 'number')
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) invalid(path)
  if (schema.type === 'boolean' && typeof value !== 'boolean') invalid(path)
  if (schema.enum && !schema.enum.includes(value as string | number)) invalid(path)
  if (schema.const !== undefined && value !== schema.const) invalid(path)
}

const catalogModels: Record<string, string> = { elders: 'Elder', records: 'CareRecord', tasks: 'CareTask', drafts: 'AIDraft', memories: 'MemoryResponse', changes: 'ChangeReviewResponse' }
export function validateCatalog(resource: string, value: unknown): Row[] {
  if (!Array.isArray(value)) invalid(resource)
  const ids = new Set<string>()
  for (const [index, item] of value.entries()) {
    const path = `${resource}[${index}]`
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) invalid(path + '.id')
    ids.add(item.id)
    if (catalogModels[resource]) checkResponse(schemas[catalogModels[resource]], item, path)
    if (resource === 'staff') {
      if (typeof item.display_name !== 'string' || !item.display_name.trim() || !['admin', 'supervisor', 'caregiver', 'nurse'].includes(item.role)) invalid(path)
    }
    if (resource === 'shifts') {
      if (typeof item.name !== 'string' || !['open', 'closed'].includes(item.status) || !Array.isArray(item.caregiver_ids) || item.caregiver_ids.some((id: unknown) => typeof id !== 'string')) invalid(path)
      for (const field of ['start_at', 'end_at']) checkResponse({ type: 'string', format: 'date-time' }, item[field], path + '.' + field)
      if (Date.parse(item.end_at) <= Date.parse(item.start_at)) invalid(path + '.end_at')
    }
  }
  return value as Row[]
}

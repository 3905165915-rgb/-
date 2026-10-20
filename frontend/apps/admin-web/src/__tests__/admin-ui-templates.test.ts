import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(filename)
    return entry.name.endsWith('.vue') ? [filename] : []
  })
}

describe('admin Vue templates', () => {
  it.each(
    vueFiles(sourceRoot).map((filename) => [
      relative(sourceRoot, filename),
      filename,
    ]),
  )('compiles event handlers and expressions in %s', (_name, filename) => {
    const parsed = parse(readFileSync(filename, 'utf8'), { filename })
    expect(parsed.errors).toEqual([])
    const template = parsed.descriptor.template
    if (!template) throw new Error('Expected admin SFC to contain a template')
    const compiled = compileTemplate({
      source: template.content,
      filename,
      id: filename,
      compilerOptions: { expressionPlugins: ['typescript'] },
    })
    expect(compiled.errors).toEqual([])
  })
})

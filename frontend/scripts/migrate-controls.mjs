import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const targets = process.argv.slice(2).filter(argument => !argument.startsWith('--'))
const files = []
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'android'].includes(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(target)
    else if (entry.name.endsWith('.vue')) files.push(target)
  }
}
if (targets.length) files.push(...targets.map(file => path.resolve(root, file)))
else for (const directory of ['apps', 'packages/shared/src']) await collect(path.join(root, directory))
let count = 0
for (const filename of files) {
  if (/[/\\]ui[/\\]Care(?:Select|DateTime)\.vue$/.test(filename)) continue
  const source = await readFile(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  if (errors.length) throw new Error(`${filename}: ${errors[0]}`)
  const edits = []
  function visit(node) {
    if (node.tag === 'select') {
      edits.push({ start: node.loc.start.offset, end: node.loc.start.offset + 7, value: '<CareSelect' })
      const closing = node.loc.end.offset - '</select>'.length
      if (source.slice(closing, node.loc.end.offset) !== '</select>') throw new Error(`Unexpected select closing tag in ${filename}`)
      edits.push({ start: closing, end: node.loc.end.offset, value: '</CareSelect>' })
    }
    if (node.tag === 'input' && node.props?.some(prop => prop.type === 6 && prop.name === 'type' && ['date', 'time', 'datetime-local'].includes(prop.value?.content))) {
      const replacement = node.loc.source.replace(/^<input\b/, '<CareDateTime').replace(/\s*\/?>$/, ' />')
      edits.push({ start: node.loc.start.offset, end: node.loc.end.offset, value: replacement })
    }
    for (const child of node.children || []) visit(child)
  }
  if (descriptor.template?.ast) visit(descriptor.template.ast)
  if (!edits.length) continue
  count += edits.length
  if (!checkOnly) {
    let next = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.value + next.slice(edit.end)
    const verified = parse(next, { filename })
    if (verified.errors.length) throw new Error(`Migration did not parse: ${filename}`)
    await writeFile(filename, next)
  }
  process.stdout.write(`${checkOnly ? 'Pending' : 'Migrated'} ${path.relative(root, filename)}\n`)
}
process.stdout.write(`${count} control-tag edits ${checkOnly ? 'pending' : 'applied'}.\n`)
if (checkOnly && count) process.exitCode = 1

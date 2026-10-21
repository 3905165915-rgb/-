import { fileURLToPath } from 'node:url'
import { normalizePath, type Plugin } from 'vite'

interface SyntaxNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

function isNode(value: unknown): value is SyntaxNode {
  return typeof value === 'object' && value !== null && 'type' in value
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit)
    } else if (isNode(value)) {
      walk(value, visit)
    }
  }
}

function componentName(name: string) {
  return name.replace(/(^|-)(\w)/g, (_, _separator: string, letter: string) =>
    letter.toUpperCase(),
  )
}

function componentStyle(name: string) {
  const path = name
    .slice(2)
    .replace(/\B([A-Z])/g, '-$1')
    .toLowerCase()
  return `element-plus/es/components/${path}/style/css.mjs`
}

export function adminElementPlus(): Plugin {
  const adminSource = normalizePath(
    fileURLToPath(new URL('../apps/admin-web/src/', import.meta.url)),
  )
  return {
    name: 'admin-element-plus-on-demand',
    enforce: 'post',
    transform(code, id) {
      const filename = normalizePath(id).split('?')[0]
      if (!filename.startsWith(adminSource) || !/\.(vue|[jt]s)$/.test(filename))
        return
      if (!code.includes('resolveComponent') && !code.includes('element-plus'))
        return

      // Parse Vue's generated JavaScript, never template text or source strings.
      const ast = this.parse(code)
      const resolvers = new Set<string>()
      const styles = new Set<string>()
      for (const statement of ast.body) {
        if (statement.type !== 'ImportDeclaration') continue
        for (const specifier of statement.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
          if (typeof imported !== 'string') continue
          if (
            statement.source.value === 'vue' &&
            imported === 'resolveComponent'
          ) {
            resolvers.add(specifier.local.name)
          }
          if (
            ['element-plus', 'element-plus/es'].includes(
              String(statement.source.value),
            ) &&
            /^El[A-Z]/.test(imported)
          ) {
            styles.add(componentStyle(imported))
          }
        }
      }

      const components = new Map<string, string>()
      const replacements: { start: number; end: number; value: string }[] = []
      walk(ast as unknown as SyntaxNode, (node) => {
        if (node.type !== 'CallExpression' || !isNode(node.callee)) return
        if (
          node.callee.type !== 'Identifier' ||
          !resolvers.has(String(node.callee.name))
        )
          return
        if (!Array.isArray(node.arguments) || node.arguments.length !== 1)
          return
        const argument = node.arguments[0]
        if (!isNode(argument) || typeof argument.value !== 'string') return
        if (!/^(el-[a-z]|El[A-Z])/.test(argument.value)) return
        const name = componentName(argument.value)
        if (!components.has(name))
          components.set(name, `__hulaoElementPlus${components.size}`)
        styles.add(componentStyle(name))
        replacements.push({
          start: node.start,
          end: node.end,
          value: components.get(name)!,
        })
      })
      if (!components.size && !styles.size) return

      let transformed = code
      for (const replacement of replacements.sort(
        (a, b) => b.start - a.start,
      )) {
        transformed =
          transformed.slice(0, replacement.start) +
          replacement.value +
          transformed.slice(replacement.end)
      }
      const imports = [...components].map(
        ([name, local]) =>
          `import { ${name} as ${local} } from 'element-plus/es';`,
      )
      imports.push(...[...styles].map((style) => `import '${style}';`))
      return { code: `${imports.join('\n')}\n${transformed}`, map: null }
    },
  }
}

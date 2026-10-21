import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizePath, parseAst } from 'vite'
import { compileTemplate } from 'vue/compiler-sfc'
import { adminElementPlus } from '../../../../build/admin-element-plus'

const frontend = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const elementPlus = dirname(require.resolve('element-plus/package.json'))

async function transform(
  code: string,
  path = 'apps/admin-web/src/Fixture.vue',
) {
  const hook = adminElementPlus().transform
  if (typeof hook !== 'function') throw new Error('Missing transform hook')
  // The helper only consumes parse; use the same parser as Vite's context.
  const context = { parse: parseAst } as ThisParameterType<typeof hook>
  const result = await hook.call(context, code, resolve(frontend, path))
  if (result == null) return undefined
  return typeof result === 'string' ? result : result.code
}

describe('admin Element Plus on-demand build helper', () => {
  it('handles Vue resolver aliases, Pascal/kebab names and deduplication', async () => {
    const code = [
      'import { resolveComponent as find } from "vue";',
      'const first = find("el-button"); const second = find("ElButton");',
      'const column = find("el-table-column");',
    ].join('\n')
    const result = await transform(code)
    expect(result?.match(/import \{ ElButton as /g)).toHaveLength(1)
    expect(result?.match(/button\/style\/css\.mjs/g)).toHaveLength(1)
    expect(result).toContain('ElTableColumn as ')
    expect(result).toContain('table-column/style/css.mjs')
    expect(result).not.toContain('find("el-button")')
    expect(result).not.toContain('find("ElButton")')
    expect(result).not.toContain('find("el-table-column")')
    expect(() => parseAst(result!)).not.toThrow()
  })

  it('preserves unrelated components, dynamic names, strings and comments', async () => {
    const code = [
      'import { resolveComponent as find } from "vue";',
      'const button = find("el-button");',
      'const local = find("LocalWidget"); const dynamic = find(componentName);',
      'const text = \'find("el-fake")\';',
      '// find("el-fake")',
    ].join('\n')
    const result = await transform(code)
    expect(result).toContain('find("LocalWidget")')
    expect(result).toContain('find(componentName)')
    expect(result).toContain('const text = \'find("el-fake")\';')
    expect(result).toContain('// find("el-fake")')
    expect(result).not.toContain('ElFake as ')
  })

  it.each(['element-plus', 'element-plus/es'])(
    'adds styles for aliased service imports from %s',
    async (source) => {
      const result = await transform(
        `import { ElMessageBox as confirmBox, ElMessage } from '${source}';`,
        'apps/admin-web/src/services/fixture.ts',
      )
      expect(result).toContain('message-box/style/css.mjs')
      expect(result).toContain('message/style/css.mjs')
      expect(result).toContain('ElMessageBox as confirmBox')
    },
  )

  it.each([
    'apps/mobile/src/Fixture.vue',
    'packages/shared/src/Fixture.ts',
    'apps/admin-web/src-other/Fixture.vue',
    'apps/admin-web/src/Fixture.css',
  ])('does not transform outside admin JS/Vue: %s', async (path) => {
    expect(
      await transform(
        'import { resolveComponent } from "vue"; resolveComponent("el-button");',
        path,
      ),
    ).toBeUndefined()
  })

  it.each([
    'const resolveComponent = (name) => name; resolveComponent("el-button");',
    'import { resolveComponent } from "other-library"; resolveComponent("el-button");',
  ])('ignores functions not imported from Vue: %s', async (code) => {
    expect(await transform(code)).toBeUndefined()
  })

  it.each([false, true])(
    'handles actual Vue compiler output (isProd=%s)',
    async (isProd) => {
      const filename = resolve(frontend, 'apps/admin-web/src/Fixture.vue')
      const compiled = compileTemplate({
        source: '<el-button /><ElTableColumn /><LocalWidget />',
        filename,
        id: 'bundle-regression',
        isProd,
      })
      expect(compiled.errors).toEqual([])
      const result = await transform(compiled.code)
      expect(result).toContain('ElButton as ')
      expect(result).toContain('ElTableColumn as ')
      expect(result).toContain('_resolveComponent("LocalWidget")')
      expect(result).not.toMatch(
        /_resolveComponent\("(?:el-button|ElTableColumn)"\)/,
      )
      expect(() => parseAst(result!)).not.toThrow()
    },
  )

  it('emits real installed style entries, including numeric names and service dependencies', async () => {
    const result = await transform(
      [
        'import { resolveComponent as find } from "vue";',
        'import { ElMessageBox, ElMessage } from "element-plus";',
        'find("el-table-column"); find("ElSelectV2"); find("el-input-otp");',
      ].join('\n'),
    )
    const ast = parseAst(result!)
    const styles = ast.body
      .filter((node) => node.type === 'ImportDeclaration')
      .map((node) => node.source.value)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.endsWith('/style/css.mjs'),
      )
    expect(styles).toHaveLength(5)
    for (const style of styles) {
      expect(() =>
        readFileSync(
          resolve(elementPlus, style.slice('element-plus/'.length)),
          'utf8',
        ),
      ).not.toThrow()
    }
    const serviceCss = readFileSync(
      resolve(elementPlus, 'es/components/message-box/style/css.mjs'),
      'utf8',
    )
    for (const dependency of ['base', 'input', 'button', 'overlay']) {
      expect(serviceCss).toContain(`../../${dependency}/style/css.mjs`)
    }
    expect(serviceCss).toContain('element-plus/theme-chalk/el-message-box.css')
  })

  it('makes unknown Element Plus-prefixed names fail module resolution rather than silently falling back', async () => {
    const result = await transform(
      'import { resolveComponent } from "vue"; resolveComponent("el-not-a-real-component");',
    )
    expect(result).toContain('ElNotARealComponent as ')
    expect(result).toContain('not-a-real-component/style/css.mjs')
    const exports = parseAst(
      readFileSync(resolve(elementPlus, 'es/index.mjs'), 'utf8'),
    )
      .body.filter((node) => node.type === 'ExportNamedDeclaration')
      .flatMap((node) => node.specifiers)
      .map((specifier) =>
        specifier.exported.type === 'Identifier'
          ? specifier.exported.name
          : specifier.exported.value,
      )
    expect(exports).not.toContain('ElNotARealComponent')
    expect(() =>
      readFileSync(
        resolve(
          elementPlus,
          'es/components/not-a-real-component/style/css.mjs',
        ),
      ),
    ).toThrow()
  })

  it('also transforms Vue template subrequests under the admin source root', async () => {
    const result = await transform(
      'import { resolveComponent } from "vue"; resolveComponent("el-button");',
      `${normalizePath('apps/admin-web/src/Fixture.vue')}?vue&type=template`,
    )
    expect(result).toContain('ElButton as ')
  })
})

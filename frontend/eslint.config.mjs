import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default tseslint.config(
  eslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
)

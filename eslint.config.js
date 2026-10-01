import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.ts', '*.js', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    // E2E code passed to page.evaluate() runs in the renderer.
    files: ['scripts/smoke-e2e.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    // shadcn/ui components export their variant helpers next to the component.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' }
  },
  {
    // The renderer must only talk to main through window.hachi.
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['electron'], patterns: ['node:*', '@main/*', '**/main/**', '**/preload/**'] }
      ]
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }]
    }
  },
  prettier
)

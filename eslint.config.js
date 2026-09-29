import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'docs/**',
      'services/**',
      'ai-eval/**',
      'tools/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['e2e/**', 'tools/**', '**/*.mjs', 'playwright.config.ts', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // E2E 透過未型別化的 window.__editor 測試鉤子操作
    files: ['e2e/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/{editor-2d,viewer-3d,app-state}/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // 02 §8：UI 禁止硬編碼字串（JSX 文字節點必須走 i18n）
    files: ['apps/web/src/**/*.tsx', 'packages/editor-2d/src/**/*.tsx', 'packages/viewer-3d/src/**/*.tsx'],
    plugins: { i18next },
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }] },
  },
  {
    // 套件邊界（B10）：核心套件不得依賴 React / three / DOM
    files: ['packages/scene-schema/**/*.ts', 'packages/core-geometry/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-*', 'three', 'three/*', '@react-three/*', 'konva', 'pixi.js'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator'],
    },
  },
);

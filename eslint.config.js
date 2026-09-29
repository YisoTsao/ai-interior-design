import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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

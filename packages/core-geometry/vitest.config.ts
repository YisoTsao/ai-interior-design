import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'json-summary'],
      // B10 / SKILL P1 Gate：分支覆蓋 ≥ 90%（硬性）
      thresholds: { branches: 90, lines: 90, functions: 90, statements: 90 },
    },
  },
});

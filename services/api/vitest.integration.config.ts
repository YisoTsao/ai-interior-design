import { defineConfig } from 'vitest/config';

/** 整合/契約測試：globalSetup 以 Testcontainers 起 Postgres/Redis/MinIO 一次，各檔共用 */
export default defineConfig({
  test: {
    globalSetup: ['./test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
    env: { LOG_LEVEL: 'silent' },
  },
});

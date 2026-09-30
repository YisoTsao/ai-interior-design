import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 整合/契約測試共用容器：單一 worker 依序跑，避免重複啟動容器
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});

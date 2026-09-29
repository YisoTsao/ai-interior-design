import { defineConfig } from '@playwright/test';

/** E2E（ADR-015：根目錄 e2e/）。本機用已安裝的 Chrome；CI 用 playwright 內建 chromium。 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e/results/report.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @interiorai/web build && pnpm --filter @interiorai/web preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

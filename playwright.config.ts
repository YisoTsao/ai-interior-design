import { cpus } from 'node:os';
import { defineConfig } from '@playwright/test';

/**
 * Apple Silicon 上若 Node 跑在 Rosetta（process.arch === 'x64'），Playwright 會以 x86_64 啟動 universal 版 Chrome，
 * JIT 程式碼需經 Rosetta 轉譯，3D 首次載入慢 ~15 倍（實測 36s vs 2.2s）。此時改用原生 arm64 包裝啟動。
 */
const rosetta = process.platform === 'darwin' && process.arch === 'x64' && /Apple/.test(cpus()[0]?.model ?? '');
const launchOptions = process.env.CI ? {} : rosetta ? { executablePath: 'tools/chrome-arm64.sh' } : { channel: 'chrome' };

/** E2E（ADR-015：根目錄 e2e/）。本機用已安裝的 Chrome；CI 用 playwright 內建 chromium。 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e/results/report.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions,
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

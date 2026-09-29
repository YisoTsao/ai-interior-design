// 用 Playwright（Chrome，headed-less GPU 可能受限）量測；結果寫入 results.json
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';

const server = await createServer({ root: import.meta.dirname, server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const results = [];
for (const engine of ['konva', 'konva-opt', 'pixi']) {
  for (let run = 0; run < 3; run++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:5199/?engine=${engine}`);
    const r = await page.waitForFunction(() => window.__bench, null, { timeout: 60000 }).then((h) => h.jsonValue());
    results.push({ ...r, run });
    await page.close();
  }
}
await browser.close();
await server.close();
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2));
console.table(results);

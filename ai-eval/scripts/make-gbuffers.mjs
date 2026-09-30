// 預先產生評測集 G-buffer（05 §8）：以真實 web app（vite preview）載入每個場景，固定剖面模型東南等角相機，
// 輸出 ai-eval/gbuffers/<id>/{color,depth,edge,objectId}.png＋meta.json（含 idMap）。
// 用法：pnpm --filter @interiorai/web build && pnpm --filter @interiorai/ai-eval gbuffers
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const root = new URL('../../', import.meta.url);
const W = 512;
const H = 384;
const preview = spawn('pnpm', ['--filter', '@interiorai/web', 'preview', '--port', '4180', '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  detached: true, // 自成 process group，結束時連同 vite 子程序一起關掉
});
await new Promise((r) => setTimeout(r, 3000));
const rosetta =
  process.platform === 'darwin' && process.arch === 'x64' && /Apple/.test(cpus()[0]?.model ?? '');
const browser = await chromium.launch(
  process.env.CI
    ? {}
    : rosetta
      ? { executablePath: new URL('tools/chrome-arm64.sh', root).pathname }
      : { channel: 'chrome' },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto('http://localhost:4180/');
  await page.evaluate(() => localStorage.setItem('viewStyle', 'dollhouse'));
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-create').click();
  await page.waitForFunction(() => window.__editor);
  const files = readdirSync(new URL('../scenes/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of files) {
    const { id, scene } = JSON.parse(readFileSync(new URL(`../scenes/${f}`, import.meta.url), 'utf8'));
    await page.evaluate((sc) => {
      const s = window.__editor.store.getState();
      s.load({ projectId: s.projectId, projectName: 'eval', scene: sc });
      s.setView('2d');
    }, scene);
    await page.getByTestId('view-3d').click();
    await page.waitForFunction(() => window.__editor.viewer3d()?.info().calls > 0, null, { timeout: 60_000 });
    const out = await page.evaluate(
      async ({ W, H }) => {
        const v = window.__editor.viewer3d();
        v.viewPreset('iso-se');
        const g = v.gbuffer({ width: W, height: H, clay: true });
        const png = (img) => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          c.getContext('2d').putImageData(
            new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
            0,
            0,
          );
          return c.toDataURL('image/png').split(',')[1];
        };
        const expand = (gray, k = 1) => {
          const d = new Uint8Array(gray.width * gray.height * 4);
          gray.data.forEach((x, i) => d.set([x * k, x * k, x * k, 255], i * 4));
          return { width: gray.width, height: gray.height, data: d };
        };
        return {
          color: png(g.color),
          depth: png(expand(g.depth)),
          edge: png(expand(g.edge, 255)),
          objectId: png(g.objectId),
          meta: { ...g.meta, idMap: g.idMap },
        };
      },
      { W, H },
    );
    const dir = new URL(`../gbuffers/${id}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    for (const k of ['color', 'depth', 'edge', 'objectId'])
      writeFileSync(new URL(`${k}.png`, dir), Buffer.from(out[k], 'base64'));
    writeFileSync(new URL('meta.json', dir), JSON.stringify(out.meta));
    console.log(`✓ ${id}`);
  }
} finally {
  await browser.close();
  process.kill(-preview.pid, 'SIGTERM');
}

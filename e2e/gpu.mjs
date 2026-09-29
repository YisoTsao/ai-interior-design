import { chromium } from '@playwright/test';
const variants = {
  default: [],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  headed: 'headed',
};
for (const [name, args] of Object.entries(variants)) {
  const b = await chromium.launch({ channel: 'chrome', headless: args !== 'headed', args: Array.isArray(args) ? args : [] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:4173/');
  const renderer = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const d = c?.getExtension('WEBGL_debug_renderer_info');
    return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none';
  });
  await p.getByTestId('new-sample').click();
  await p.waitForFunction(() => window.__editor && document.querySelector('[data-testid=plan2d]'), null, { timeout: 30000 });
  const t0 = Date.now();
  await p.evaluate(() => window.__editor.store.getState().setView('3d'));
  await p.waitForFunction(() => window.__editor.viewer3d()?.info().calls > 0, null, { timeout: 90000 }).catch(() => {});
  console.log(name.padEnd(12), String(Date.now() - t0).padStart(6), 'ms', renderer.slice(0, 70));
  await b.close();
}

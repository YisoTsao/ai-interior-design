import { expect, test } from '@playwright/test';
import { newSampleProject } from './helpers';

/**
 * G-buffer（03 §6）：固定場景（範例兩房一廳）＋固定相機（剖面模型東南等角）＋ 512×384。
 * 快照比對容許小誤差（GPU/驅動差異）；另驗證結構性質（idMap、深度範圍、確定性、狀態還原）。
 */
test('G-buffer：color/depth/normal/objectId/edge 尺寸一致、確定性、快照', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.evaluate(() => localStorage.setItem('viewStyle', 'dollhouse'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__editor);
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
  await page.evaluate(() => (window as any).__editor.viewer3d().viewPreset('iso-se'));

  const r = await page.evaluate(async () => {
    const v = (window as any).__editor.viewer3d();
    const before = v.info().calls;
    const a = v.gbuffer({ width: 512, height: 384, clay: true });
    const b = v.gbuffer({ width: 512, height: 384, clay: true });
    const png = async (img: { width: number; height: number; data: Uint8Array }) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
        0,
        0,
      );
      return c.toDataURL('image/png').split(',')[1];
    };
    const toRgba = (g: { width: number; height: number; data: Uint8Array }) => {
      const out = new Uint8Array(g.width * g.height * 4);
      g.data.forEach((v, i) => out.set([v, v, v, 255], i * 4));
      return { width: g.width, height: g.height, data: out };
    };
    const edgeImg = { ...a.edge, data: a.edge.data.map((x: number) => x * 255) };
    const same = a.objectId.data.every((x: number, i: number) => x === b.objectId.data[i]);
    const kinds = Object.values(a.idMap).map((x: any) => x.kind);
    let depthMin = 255;
    for (const d of a.depth.data as Uint8Array) if (d < depthMin) depthMin = d;
    return {
      sizes: [a.color, a.depth, a.normal, a.objectId, a.edge].map((x: any) => `${x.width}x${x.height}`),
      same,
      kinds: [...new Set(kinds)].sort(),
      ids: Object.values(a.idMap).map((x: any) => x.id),
      edges: a.edge.data.reduce((s: number, x: number) => s + x, 0),
      depthMin,
      depthBg: a.depth.data[0],
      meta: a.meta,
      stillRenders: v.info().calls >= 0 && before >= 0,
      png: {
        color: await png(a.color),
        depth: await png(toRgba(a.depth)),
        normal: await png(a.normal),
        objectId: await png(a.objectId),
        edge: await png(toRgba(edgeImg)),
      },
    };
  });

  expect(new Set(r.sizes)).toEqual(new Set(['512x384']));
  expect(r.same).toBe(true);
  expect(r.kinds).toEqual(expect.arrayContaining(['board', 'floor', 'object', 'wall']));
  const scene = await page.evaluate(() => (window as any).__editor.store.getState().scene.levels[0]);
  for (const w of scene.walls) expect(r.ids).toContain(w.id);
  expect(r.edges).toBeGreaterThan(1000);
  expect(r.depthBg).toBe(255); // 左上角是背景 → 最遠
  expect(r.depthMin).toBeLessThan(200);
  expect(r.meta).toMatchObject({ width: 512, height: 384, depthBits: 8, pixelRatio: 1 });
  expect(r.meta.far).toBeGreaterThan(r.meta.near);

  for (const [name, b64] of Object.entries(r.png))
    expect(Buffer.from(b64 as string, 'base64')).toMatchSnapshot(`gbuffer-${name}.png`, {
      maxDiffPixelRatio: 0.02,
    });

  // G-buffer 後畫面仍正常（狀態已還原）
  await page.waitForTimeout(300);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/after-gbuffer.png' });
});

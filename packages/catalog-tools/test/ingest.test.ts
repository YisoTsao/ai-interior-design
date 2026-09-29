import { Document, NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { ingestGlb } from '../src/index.js';

/** 產生一個 w×h×d（公尺）的方塊 glb；offset 可模擬原點錯誤 */
async function boxGlb(w: number, h: number, d: number, offset: [number, number, number] = [0, 0, 0]) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const [ox, oy, oz] = offset;
  const x0 = -w / 2 + ox,
    x1 = w / 2 + ox,
    y0 = oy,
    y1 = h + oy,
    z0 = -d / 2 + oz,
    z1 = d / 2 + oz;
  const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const idx = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7,
    3,
  ];
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind);
  const mesh = doc.createMesh('box').addPrimitive(prim);
  const node = doc.createNode('box').setMesh(mesh);
  doc.createScene('s').addChild(node);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]!);
  return new NodeIO().writeBinary(doc);
}

const base = {
  id: 'sofa_x',
  nameZh: '測試沙發',
  category: 'living' as const,
  dimsMm: { w: 2000, d: 900, h: 800 },
  modelUrl: 'assets/sofa_x/model.glb',
};
const license = {
  type: 'CC0',
  source: 'https://example.org/asset',
  allowedUse: ['commercial', 'render'] as ('commercial' | 'render')[],
};

describe('catalog ingest（07 §2）', () => {
  it('尺寸/原點正確＋授權齊 → review（不自動 published）', async () => {
    const r = await ingestGlb(await boxGlb(2, 0.8, 0.9), { ...base, license });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.entry?.status).toBe('review');
    expect(Math.round(r.measured.wMm)).toBe(2000);
    expect(r.measured.triangles).toBe(12);
  });
  it('缺授權 → draft 並警告', async () => {
    const r = await ingestGlb(await boxGlb(2, 0.8, 0.9), base);
    expect(r.entry?.status).toBe('draft');
    expect(r.issues.map((i) => i.code)).toContain('LICENSE_MISSING');
  });
  it('單位錯誤（以 mm 建模）→ DIMS_MISMATCH 拒絕', async () => {
    const r = await ingestGlb(await boxGlb(2000, 800, 900), { ...base, license });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'DIMS_MISMATCH')).toBe(true);
  });
  it('原點不在底部中心 → ORIGIN 拒絕；誤差 1.5% 內可接受', async () => {
    const bad = await ingestGlb(await boxGlb(2, 0.8, 0.9, [0.5, 0, 0]), { ...base, license });
    expect(bad.issues.some((i) => i.code === 'ORIGIN')).toBe(true);
    const near = await ingestGlb(await boxGlb(2.03, 0.8, 0.9), { ...base, license });
    expect(near.ok).toBe(true);
  });
  it('非 glb 資料 → 解析失敗', async () => {
    const r = await ingestGlb(new Uint8Array([1, 2, 3, 4]), { ...base, license });
    expect(r.ok).toBe(false);
  });
});

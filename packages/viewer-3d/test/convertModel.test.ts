import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import {
  expandFiles,
  guessUnit,
  loadModelSource,
  ModelImportError,
  pickMainFile,
  simplifyObject,
} from '../src/convertModel.js';

const enc = (s: string) => new TextEncoder().encode(s);
const OBJ = `mtllib chair.mtl
v 0 0 0
v 50 0 0
v 50 0 40
v 0 0 40
v 0 90 0
usemtl wood
f 1 2 3
f 1 3 4
f 1 2 5
`;
const MTL = `newmtl wood
Kd 0.6 0.4 0.2
Ns 50
`;
const STL = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1000 0 0
vertex 0 800 0
endloop
endfacet
endsolid t
`;

describe('多格式模型匯入', () => {
  it('主檔優先序；只有 SKP 時提示從 SketchUp 匯出', () => {
    const f = (name: string) => ({ name, data: new Uint8Array() });
    expect(pickMainFile([f('a.mtl'), f('a.obj'), f('t.png')]).format).toBe('obj');
    expect(pickMainFile([f('a.bin'), f('a.gltf')]).format).toBe('gltf');
    expect(() => pickMainFile([f('house.skp')])).toThrow(ModelImportError);
    expect(() => pickMainFile([f('house.skp')])).toThrow('UPLOAD_SKP');
    expect(() => pickMainFile([f('readme.txt')])).toThrow('UPLOAD_FORMAT');
  });

  it('zip 展開（含資料夾，略過 __MACOSX）', () => {
    const zip = zipSync({ 'chair/chair.obj': enc(OBJ), 'chair/chair.mtl': enc(MTL), '__MACOSX/x': enc('x') });
    const out = expandFiles([{ name: 'chair.zip', data: zip }]);
    expect(out.map((f) => f.name).sort()).toEqual(['chair/chair.mtl', 'chair/chair.obj']);
  });

  it('單位推測：最長邊落在 0.2–6 m', () => {
    expect(guessUnit(1.8)).toBe('m');
    expect(guessUnit(180)).toBe('cm');
    expect(guessUnit(1800)).toBe('mm');
    expect(guessUnit(0.0005)).toBe('m');
  });

  it('OBJ＋MTL：讀到材質顏色並轉成 PBR；推測單位為 cm', async () => {
    const s = await loadModelSource([
      { name: 'chair.obj', data: enc(OBJ) },
      { name: 'chair.mtl', data: enc(MTL) },
    ]);
    expect(s.format).toBe('obj');
    expect(s.triangles).toBe(3);
    expect(s.suggestedUnit).toBe('cm');
    expect(s.missing).toEqual([]);
    let mat: THREE.MeshStandardMaterial | undefined;
    s.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh)
        mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    });
    expect(mat?.isMeshStandardMaterial).toBe(true);
    expect(mat!.color.r).toBeGreaterThan(mat!.color.b);
  });

  it('OBJ 缺 MTL：列為缺少的檔案', async () => {
    const s = await loadModelSource([{ name: 'chair.obj', data: enc(OBJ) }]);
    expect(s.missing).toEqual(['chair.mtl']);
  });

  it('STL（ASCII）：Z-up、單位 mm', async () => {
    const s = await loadModelSource([{ name: 'part.stl', data: enc(STL) }]);
    expect(s.format).toBe('stl');
    expect(s.suggestedZUp).toBe(true);
    expect(s.suggestedUnit).toBe('mm');
  });

  it('減面：三角形數降到目標附近', async () => {
    const root = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial());
    const before = (root.geometry.index!.count / 3) | 0;
    const after = await simplifyObject(root, 0.25);
    expect(after).toBeLessThan(before * 0.4);
    expect(after).toBeGreaterThan(0);
  });
});

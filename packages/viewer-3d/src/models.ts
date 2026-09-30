import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 外部 3D 模型（GLB／自含式 glTF）載入（ADR-023）。
 * url 由應用層的 resolver 轉成位元組（例如使用者上傳、存在 IndexedDB 的 `user-asset:<id>`）；
 * 預設直接 fetch。模型正規化：底部中心為原點、+Y 向上，並記錄原始包圍盒尺寸（檔案單位）。
 */
export type ModelResolver = (url: string) => Promise<ArrayBuffer>;
let resolver: ModelResolver = async (url) => (await fetch(url)).arrayBuffer();
export function setModelResolver(r: ModelResolver) {
  resolver = r;
  cache.clear();
}

export interface LoadedModel {
  root: THREE.Object3D;
  /** 原始包圍盒尺寸（檔案單位；glTF 為公尺） */
  size: THREE.Vector3;
  meshes: number;
  triangles: number;
}

const cache = new Map<string, Promise<LoadedModel>>();

/** 解析 GLB/glTF 位元組並正規化（上傳預覽與顯示共用） */
export async function parseModel(data: ArrayBuffer): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(data, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('EMPTY_MODEL');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  wrap.add(root);
  let meshes = 0;
  let triangles = 0;
  wrap.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return { root: wrap, size, meshes, triangles: Math.round(triangles) };
}

export function loadModel(url: string): Promise<LoadedModel> {
  let p = cache.get(url);
  if (!p) {
    p = resolver(url).then(parseModel);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** React：載入中回傳 null；失敗回傳 'error' */
export function useModel(url: string | undefined): LoadedModel | null | 'error' {
  const [m, setM] = useState<LoadedModel | null | 'error'>(null);
  useEffect(() => {
    if (!url) return;
    let dead = false;
    setM(null);
    loadModel(url).then(
      (x) => !dead && setM(x),
      () => !dead && setM('error'),
    );
    return () => {
      dead = true;
    };
  }, [url]);
  return url ? m : null;
}

/**
 * 物件用的模型副本：幾何與材質共用；依目錄尺寸（mm）對檔案包圍盒各軸縮放。
 * 每個 mesh 帶 G-buffer 標記（AI 渲染的 objectId）。
 */
export function instantiateModel(
  m: LoadedModel,
  dimsMm: { w: number; d: number; h: number },
  tag: { id: string },
  shadows: boolean,
): THREE.Object3D {
  const c = m.root.clone(true);
  c.scale.set(
    dimsMm.w / Math.max(1e-6, m.size.x),
    dimsMm.h / Math.max(1e-6, m.size.y),
    dimsMm.d / Math.max(1e-6, m.size.z),
  );
  c.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData = { gkind: 'object', id: tag.id };
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
  return c;
}

import * as THREE from 'three';
import type { CatalogEntry, Material } from '@interiorai/catalog';
import { buildFurnitureGeometry, hasEmissive } from './furniture.js';
import { lightColorHex } from './lighting.js';
import { loadModel } from './models.js';
import { presetDirection } from './style.js';

/**
 * 資產縮圖（ADR-023）：以共用的離屏 renderer 即時渲染參數化家具／上傳模型的等角小圖，快取 dataURL。
 * 不需要預先產生圖檔；幾何與 3D 視圖用的是同一套（剖面模型風格）。
 */
const SIZE = 160;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function setup() {
  if (renderer || typeof document === 'undefined') return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  return renderer;
}

function shoot(obj: THREE.Object3D): string | null {
  const r = setup();
  if (!r) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8a58c', 1.4));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  sun.position.set(-1, 2, 1.5);
  scene.add(sun);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(28, 1, 1, 1e7);
  const dir = new THREE.Vector3(...presetDirection(35, 28));
  const dist = sphere.radius / Math.sin(((28 / 2) * Math.PI) / 180);
  cam.position.copy(sphere.center).addScaledVector(dir, dist * 1.02);
  cam.near = dist / 100;
  cam.far = dist * 4;
  cam.lookAt(sphere.center);
  cam.updateProjectionMatrix();
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  return r.domElement.toDataURL('image/png');
}

/** 任意物件的縮圖（上傳預覽用；不快取） */
export function renderThumbnail(obj: THREE.Object3D): string | null {
  return shoot(obj);
}

/** 參數化家具的縮圖（同步；呼叫端負責分批，避免阻塞 UI） */
export function catalogThumbnail(
  entry: CatalogEntry,
  materials: ReadonlyMap<string, Material>,
): string | null {
  const hit = cache.get(entry.id);
  if (hit) return hit;
  if (entry.model.kind !== 'parametric') return null;
  const slot = entry.materialSlots[0];
  const body = (slot && materials.get(slot.defaultMaterialId)?.color) ?? '#cfc6b8';
  const g = buildFurnitureGeometry(entry, undefined, { style: 'dollhouse', bodyColor: body });
  const surf = slot ? materials.get(slot.defaultMaterialId) : undefined;
  const mats: THREE.Material[] = [
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: surf?.roughness ?? 0.7,
      metalness: surf?.metalness ?? 0,
    }),
  ];
  if (hasEmissive(g)) {
    const p = entry.model.params.color?.default;
    mats.push(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(lightColorHex(p ? String(p) : undefined)).multiplyScalar(1.4),
      }),
    );
  }
  const mesh = new THREE.Mesh(g, mats.length > 1 ? mats : mats[0]);
  const url = shoot(mesh);
  g.dispose();
  mats.forEach((m) => m.dispose());
  if (url) cache.set(entry.id, url);
  return url;
}

/** 上傳模型（GLB）的縮圖（非同步） */
export async function modelThumbnail(entry: CatalogEntry): Promise<string | null> {
  const hit = cache.get(entry.id);
  if (hit) return hit;
  if (entry.model.kind !== 'glb') return null;
  const m = await loadModel(entry.model.url);
  const url = shoot(m.root.clone(true));
  if (url) cache.set(entry.id, url);
  return url;
}

export const cachedThumbnail = (id: string) => cache.get(id);

/** 預覽用物件（資產詳情的可旋轉 3D）：參數化家具可指定主材質；上傳模型直接複製 */
export async function buildPreviewObject(
  entry: CatalogEntry,
  materials: ReadonlyMap<string, Material>,
  materialId?: string,
): Promise<THREE.Object3D | null> {
  if (entry.model.kind === 'glb') return (await loadModel(entry.model.url)).root.clone(true);
  if (entry.model.kind !== 'parametric') return null;
  const slot = entry.materialSlots[0];
  const surf = materials.get(materialId ?? slot?.defaultMaterialId ?? '');
  const g = buildFurnitureGeometry(entry, undefined, {
    style: 'dollhouse',
    bodyColor: surf?.color ?? '#cfc6b8',
  });
  const mats: THREE.Material[] = [
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: surf?.roughness ?? 0.7,
      metalness: surf?.metalness ?? 0,
    }),
  ];
  if (hasEmissive(g)) {
    const p = entry.model.params.color?.default;
    mats.push(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(lightColorHex(p ? String(p) : undefined)).multiplyScalar(1.4),
      }),
    );
  }
  return new THREE.Mesh(g, mats.length > 1 ? mats : mats[0]);
}

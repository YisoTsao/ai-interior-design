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

/**
 * 俯視圖（2D 平面家具顯示為縮圖，FE-PLAN-12）：正交相機由上往下，畫面範圍＝物件的寬×深，
 * 所以把圖貼到 2D 的佔地矩形（同樣的旋轉）就剛好對齊。+Z（物件正面）朝圖的下方，與 2D 平面座標一致。
 */
function shootTop(obj: THREE.Object3D, w: number, d: number): string | null {
  const r = setup();
  if (!r) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8a58c', 1.6));
  const sun = new THREE.DirectionalLight('#fff1dc', 1.8);
  sun.position.set(-0.6, 2, 0.8);
  scene.add(sun);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const top = box.max.y + 10;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 1, top + 100);
  cam.up.set(0, 0, -1);
  cam.position.set(0, top, 0);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  return r.domElement.toDataURL('image/png');
}
const topCache = new Map<string, string>();

/** 參數化家具／上傳模型的俯視圖（快取；上傳模型需先載入） */
export async function catalogTopView(
  entry: CatalogEntry,
  materials: ReadonlyMap<string, Material>,
): Promise<string | null> {
  const hit = topCache.get(entry.id);
  if (hit) return hit;
  const { w, d } = entry.dimsMm;
  let obj: THREE.Object3D | null = null;
  let dispose = () => {};
  if (entry.model.kind === 'glb') {
    const m = await loadModel(entry.model.url);
    const c = m.root.clone(true);
    c.scale.set(
      w / Math.max(1e-6, m.size.x),
      entry.dimsMm.h / Math.max(1e-6, m.size.y),
      d / Math.max(1e-6, m.size.z),
    );
    obj = c;
  } else {
    obj = await buildPreviewObject(entry, materials);
    const mesh = obj as THREE.Mesh | null;
    dispose = () => {
      mesh?.geometry?.dispose();
      (Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]).forEach((x) => x?.dispose());
    };
  }
  if (!obj) return null;
  const url = shootTop(obj, w, d);
  dispose();
  if (url) topCache.set(entry.id, url);
  return url;
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

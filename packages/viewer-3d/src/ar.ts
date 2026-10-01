import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { CatalogEntry, Material } from '@interiorai/catalog';
import { buildPreviewObject } from './thumbnails.js';

/**
 * AR 預覽（FE-MOB-03）：以真實尺寸把家具放進鏡頭畫面。
 * - Android／Chrome：WebXR immersive-ar＋hit-test（偵測地面，點一下放置）。
 * - iOS：AR Quick Look（瀏覽器內匯出 USDZ，以 rel="ar" 開啟）。
 * 物件以公尺為單位（場景 mm × 0.001）。
 */
export type ArSupport = 'webxr' | 'quicklook' | 'none';

export async function arSupport(): Promise<ArSupport> {
  if (typeof navigator === 'undefined') return 'none';
  const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
  try {
    if (xr && (await xr.isSessionSupported('immersive-ar'))) return 'webxr';
  } catch {
    /* ignore */
  }
  const a = document.createElement('a');
  if (a.relList?.supports?.('ar')) return 'quicklook';
  return 'none';
}

/** 家具（公尺、底部中心為原點） */
export async function arObject(
  entry: CatalogEntry,
  materials: ReadonlyMap<string, Material>,
  materialId?: string,
): Promise<THREE.Object3D | null> {
  const obj = await buildPreviewObject(entry, materials, materialId);
  if (!obj) return null;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const k =
    entry.model.kind === 'glb'
      ? new THREE.Vector3(
          entry.dimsMm.w / size.x / 1000,
          entry.dimsMm.h / size.y / 1000,
          entry.dimsMm.d / size.z / 1000,
        )
      : new THREE.Vector3(0.001, 0.001, 0.001);
  const wrap = new THREE.Group();
  obj.scale.multiply(k);
  wrap.add(obj);
  return wrap;
}

/** iOS AR Quick Look：USDZ Blob */
export async function exportUsdz(obj: THREE.Object3D): Promise<Blob> {
  const scene = new THREE.Scene();
  scene.add(obj.clone(true));
  const buf = await new USDZExporter().parseAsync(scene);
  return new Blob([buf as BlobPart], { type: 'model/vnd.usdz+zip' });
}

/**
 * 啟動 WebXR AR：回傳結束函式。overlay＝DOM 覆蓋層（提示與結束按鈕）。
 * 第一次點擊放置家具，之後點擊移動到新的偵測點；兩指旋轉不支援（點擊兩次同點＝轉 45°）。
 */
export async function startWebXrAr(
  obj: THREE.Object3D,
  overlay: HTMLElement,
  onEnd: () => void,
): Promise<() => void> {
  const xr = (navigator as unknown as { xr: XRSystem }).xr;
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  } as XRSessionInit);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#bbbbbb', 2.5));
  const camera = new THREE.PerspectiveCamera();
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#f2c14e' }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  const placed = obj.clone(true);
  placed.visible = false;
  scene.add(placed);
  const viewer = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource!({ space: viewer });
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  session.addEventListener('select', () => {
    if (!reticle.visible) return;
    reticle.matrix.decompose(p, q, s);
    if (placed.visible && placed.position.distanceTo(p) < 0.05) placed.rotation.y += Math.PI / 4;
    placed.position.copy(p);
    placed.visible = true;
  });
  renderer.setAnimationLoop((_t, frame) => {
    if (frame && source) {
      const ref = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(source);
      const pose = hits[0] && ref ? hits[0].getPose(ref) : undefined;
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
    }
    renderer.render(scene, camera);
  });
  const end = () => {
    renderer.setAnimationLoop(null);
    source?.cancel();
    void session.end().catch(() => {});
  };
  session.addEventListener('end', () => {
    renderer.dispose();
    onEnd();
  });
  return end;
}

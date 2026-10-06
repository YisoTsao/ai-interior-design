import * as THREE from 'three';
import { encodeId, gray, rgba, structuralEdges, type Gray, type RGBA } from '@interiorai/image-ops';

/** G-buffer 中的物件種類（idMap 用；AI 局部重繪以物件選取遮罩） */
export type GKind = 'wall' | 'floor' | 'ceiling' | 'opening' | 'object' | 'board';

export interface GBufferMeta {
  width: number;
  height: number;
  /** 深度：線性視距 near..far → 0..255（8-bit，顯式標註，03 §6） */
  depthBits: 8;
  near: number;
  far: number;
  pixelRatio: 1;
  camera: { position: [number, number, number]; target: [number, number, number]; fovDeg: number };
}

export interface GBuffer {
  meta: GBufferMeta;
  color: RGBA;
  depth: Gray;
  normal: RGBA;
  objectId: RGBA;
  edge: Gray;
  /** objectId 顏色編碼（整數）→ 場景 id */
  idMap: Record<number, { id: string; kind: GKind }>;
}

/** 標記可進 G-buffer 的 mesh；ids 為 InstancedMesh 每個 instance 的場景 id */
export interface GBufferTag {
  gkind: GKind;
  id?: string;
  ids?: string[];
}

const readTarget = (gl: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, w: number, h: number) => {
  const buf = new Uint8Array(w * h * 4);
  gl.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  // WebGL 由下而上 → 翻轉成影像座標
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return rgba(w, h, out);
};

/**
 * 離屏 G-buffer（03 §6）：同一相機、同一尺寸依序渲染 color/clay、depth、normal、objectId，
 * 再由 objectId 與深度邊界算 edge。pixelRatio 固定 1、objectId 不抗鋸齒、各圖尺寸相同。
 * 只渲染帶 userData.gkind 的 mesh（隱藏 TransformControls 等輔助物件）；完成後還原所有狀態。
 */
export function renderGBuffer(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  viewCamera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  opts: { width: number; height: number; clay?: boolean },
): GBuffer {
  const { width: w, height: h } = opts;
  const camera = viewCamera.clone();
  camera.aspect = w / h;

  // 近/遠平面由場景包圍盒推得（寫入 meta，03 §6 固定條件）
  const tagged: THREE.Mesh[] = [];
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const tag = o.userData as Partial<GBufferTag>;
    if ((o as THREE.Mesh).isMesh && tag.gkind) tagged.push(o as THREE.Mesh);
    else if (
      ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) &&
      o.visible
    ) {
      hidden.push(o);
      o.visible = false;
    }
  });
  const box = new THREE.Box3();
  for (const m of tagged) if (m.visible) box.expandByObject(m);
  const corners = box.isEmpty()
    ? [new THREE.Vector3()]
    : [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) =>
          new THREE.Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ),
      );
  const dists = corners.map((c) => c.distanceTo(camera.position));
  camera.far = Math.max(...dists) * 1.02 + 10;
  camera.near = Math.max(10, Math.min(...dists) * 0.5);
  camera.updateProjectionMatrix();

  const rt = new THREE.WebGLRenderTarget(w, h, {
    samples: 0,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  const prev = {
    target: gl.getRenderTarget(),
    background: scene.background,
    override: scene.overrideMaterial,
    toneMapping: gl.toneMapping,
    shadowAuto: gl.shadowMap.autoUpdate,
    clearColor: gl.getClearColor(new THREE.Color()),
    clearAlpha: gl.getClearAlpha(),
  };
  const pass = (bg: THREE.Color | null, override: THREE.Material | null, srgb = false, clear = bg) => {
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    scene.background = bg;
    scene.overrideMaterial = override;
    gl.setRenderTarget(rt);
    gl.setClearColor(clear ?? new THREE.Color(0, 0, 0), 1);
    gl.clear();
    gl.render(scene, camera);
    return readTarget(gl, rt, w, h);
  };
  const tmp: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T) => (tmp.push(m), m);

  try {
    gl.shadowMap.autoUpdate = false;
    // 1. color / clay：與畫面的光線模式無關（夜間氛圍的彩色燈光不進 G-buffer）→ 關掉場景光源與環境，改用固定的中性光
    const lights: THREE.Light[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight && o.visible) {
        lights.push(o as THREE.Light);
        o.visible = false;
      }
    });
    const env = scene.environment;
    scene.environment = null;
    const rig = new THREE.Group();
    const hemi = new THREE.HemisphereLight('#ffffff', '#b8b2a8', 1.6);
    const key = new THREE.DirectionalLight('#ffffff', 1.8);
    key.position.set(-0.45, 1, 0.55).multiplyScalar(10000).add(target);
    key.target.position.copy(target);
    rig.add(hemi, key, key.target);
    scene.add(rig);
    let color: RGBA;
    try {
      color = pass(
        new THREE.Color('#ffffff'),
        opts.clay ? track(new THREE.MeshStandardMaterial({ color: '#a8a8a8', roughness: 1 })) : null,
        true,
      );
    } finally {
      scene.remove(rig);
      hemi.dispose();
      key.dispose();
      for (const l of lights) l.visible = true;
      scene.environment = env;
    }

    // 2. depth：RGBA packing → 解包 NDC 深度 → 線性視距 → near..far 正規化為 8-bit
    // 背景清成白色 → 解包後 ≈ 1（最遠）
    const packed = pass(
      null,
      track(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })),
      false,
      new THREE.Color(1, 1, 1),
    );
    const depth = gray(w, h);
    const { near, far } = camera;
    const down = 255 / 256;
    for (let i = 0; i < w * h; i++) {
      const [r, g, b, a] = [0, 1, 2, 3].map((k) => packed.data[i * 4 + k]! / 255) as [
        number,
        number,
        number,
        number,
      ];
      // three.js r186 unpackRGBAToDepth：r 為最高位（UnpackFactors4 = downscale / (1, 256, 256², ·), 1/256³）
      const d = Math.min(1, r * down + (g * down) / 256 + (b * down) / 65536 + a / 16777216);
      const viewZ = (near * far) / ((far - near) * d - far); // perspectiveDepthToViewZ
      depth.data[i] = Math.max(0, Math.min(255, Math.round(((-viewZ - near) / (far - near)) * 255)));
    }

    // 3. normal
    const normal = pass(new THREE.Color(0.5, 0.5, 1), track(new THREE.MeshNormalMaterial()));

    // 4. objectId：每個物件唯一純色、無光照、無抗鋸齒
    const idMap: GBuffer['idMap'] = {};
    const restore: (() => void)[] = [];
    let n = 1;
    for (const m of tagged) {
      const tag = m.userData as GBufferTag;
      const mat = track(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }));
      const orig = m.material;
      m.material = mat;
      restore.push(() => (m.material = orig));
      const inst = m as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        const prevColor = inst.instanceColor;
        const arr = new Float32Array(inst.count * 3);
        for (let k = 0; k < inst.count; k++) {
          const code = n++;
          idMap[code] = { id: tag.ids?.[k] ?? `${tag.gkind}_${k}`, kind: tag.gkind };
          const [r, g, b] = encodeId(code);
          arr.set([r / 255, g / 255, b / 255], k * 3);
        }
        inst.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
        restore.push(() => (inst.instanceColor = prevColor));
      } else {
        const code = n++;
        idMap[code] = { id: tag.id ?? `${tag.gkind}_${code}`, kind: tag.gkind };
        const [r, g, b] = encodeId(code);
        mat.color.setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
      }
    }
    const objectId = pass(new THREE.Color(0, 0, 0), null);
    restore.forEach((f) => f());

    // 5. edge：objectId 邊界 ∪ 深度邊界
    const edge = structuralEdges(objectId, depth);
    return {
      meta: {
        width: w,
        height: h,
        depthBits: 8,
        near: Math.round(near),
        far: Math.round(far),
        pixelRatio: 1,
        camera: {
          position: camera.position.toArray().map(Math.round) as [number, number, number],
          target: target.toArray().map(Math.round) as [number, number, number],
          fovDeg: camera.fov,
        },
      },
      color,
      depth,
      normal,
      objectId,
      edge,
      idMap,
    };
  } finally {
    for (const o of hidden) o.visible = true;
    gl.setRenderTarget(prev.target);
    scene.background = prev.background;
    scene.overrideMaterial = prev.override;
    gl.toneMapping = prev.toneMapping;
    gl.shadowMap.autoUpdate = prev.shadowAuto;
    gl.setClearColor(prev.clearColor, prev.clearAlpha);
    tmp.forEach((m) => m.dispose());
    rt.dispose();
  }
}

/** 瀏覽器端 PNG 編碼（8-bit RGBA；上傳 G-buffer 用） */
export async function toPng(img: RGBA): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 編碼失敗'))), 'image/png'),
  );
}

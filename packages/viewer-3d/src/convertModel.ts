import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { MeshoptSimplifier } from './meshopt.js';

/**
 * 多格式 3D 模型匯入（FE-AST-11）：在瀏覽器把 OBJ＋MTL、FBX、DAE、STL、PLY、3DS、3MF、USDZ、VRML、
 * 多檔 glTF（.gltf＋.bin＋貼圖）或上述任一的 .zip 轉成單一 GLB（貼圖內嵌）。
 * 儲存、顯示、專案檔打包都只處理 GLB，格式差異只存在於這一層。
 * SKP（SketchUp）沒有開放的瀏覽器解析器 → 回報 UPLOAD_SKP，請使用者從 SketchUp 匯出 GLB／DAE／FBX。
 */
export const MODEL_EXTENSIONS = [
  'glb',
  'gltf',
  'obj',
  'fbx',
  'dae',
  'stl',
  'ply',
  '3ds',
  '3mf',
  'usdz',
  'wrl',
  'zip',
] as const;
/** 主檔優先序（同一批檔案中有多個模型檔時取第一個） */
const MAIN_ORDER = ['glb', 'gltf', 'fbx', 'obj', 'dae', '3mf', 'usdz', '3ds', 'wrl', 'stl', 'ply'] as const;
export type ModelFormat = (typeof MAIN_ORDER)[number];
/** input accept：模型＋可能的附屬檔（材質、貼圖、bin） */
export const MODEL_ACCEPT =
  '.glb,.gltf,.bin,.obj,.mtl,.fbx,.dae,.stl,.ply,.3ds,.3mf,.usdz,.wrl,.zip,.skp,.png,.jpg,.jpeg,.webp,.tga,.bmp,.gif';

export type ModelUnit = 'm' | 'cm' | 'mm' | 'in';
const UNIT_M: Record<ModelUnit, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };

export interface SourceFile {
  name: string;
  data: Uint8Array;
}

export interface LoadedSource {
  format: ModelFormat;
  mainName: string;
  root: THREE.Object3D;
  /** 原檔沒有提供（找不到）的附屬檔名稱，例如貼圖 */
  missing: string[];
  /** 依包圍盒推測的檔案單位（讓家具落在 0.2–6 m） */
  suggestedUnit: ModelUnit;
  /** STL／PLY 等常見 Z 軸朝上 */
  suggestedZUp: boolean;
  triangles: number;
}

export class ModelImportError extends Error {
  constructor(public code: 'UPLOAD_FORMAT' | 'UPLOAD_SKP' | 'UPLOAD_PARSE' | 'EMPTY_MODEL') {
    super(code);
  }
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const base = (p: string) =>
  decodeURIComponent(p.split(/[?#]/)[0]!).replace(/\\/g, '/').split('/').pop()!.toLowerCase();

/** 展開 zip（含資料夾）；忽略 macOS 的 __MACOSX 與隱藏檔 */
export function expandFiles(files: readonly SourceFile[]): SourceFile[] {
  const out: SourceFile[] = [];
  for (const f of files) {
    if (ext(f.name) !== 'zip') {
      out.push(f);
      continue;
    }
    const z = unzipSync(f.data);
    for (const [name, data] of Object.entries(z)) {
      if (name.endsWith('/') || name.includes('__MACOSX') || base(name).startsWith('.')) continue;
      out.push({ name, data });
    }
  }
  return out;
}

/** 一批檔案中的主模型檔；只有 SKP → UPLOAD_SKP；沒有可辨識的模型 → UPLOAD_FORMAT */
export function pickMainFile(files: readonly SourceFile[]): { file: SourceFile; format: ModelFormat } {
  for (const fmt of MAIN_ORDER) {
    const f = files.find((x) => ext(x.name) === fmt);
    if (f) return { file: f, format: fmt };
  }
  if (files.some((x) => ext(x.name) === 'skp')) throw new ModelImportError('UPLOAD_SKP');
  throw new ModelImportError('UPLOAD_FORMAT');
}

/** 讓最長邊落在家具常見範圍（0.2–6 m）的單位；都不符合時取最接近 1.5 m 者 */
export function guessUnit(maxDim: number): ModelUnit {
  const units: ModelUnit[] = ['m', 'cm', 'mm', 'in'];
  const ok = units.filter((u) => {
    const m = maxDim * UNIT_M[u];
    return m >= 0.2 && m <= 6;
  });
  if (ok.length) return ok[0]!;
  return units.reduce((a, u) =>
    Math.abs(Math.log((maxDim * UNIT_M[u]) / 1.5)) < Math.abs(Math.log((maxDim * UNIT_M[a]) / 1.5)) ? u : a,
  );
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** 附屬檔以 blob URL 提供給 loader；記錄 loader 要求但找不到的檔名 */
function fileManager(files: readonly SourceFile[]) {
  const urls = new Map<string, string>();
  for (const f of files) {
    const u = URL.createObjectURL(
      new Blob([f.data as BlobPart], { type: MIME[ext(f.name)] ?? 'application/octet-stream' }),
    );
    urls.set(base(f.name), u);
  }
  const missing = new Set<string>();
  let pending = 0;
  let waiters: (() => void)[] = [];
  const manager = new THREE.LoadingManager();
  const start = manager.itemStart.bind(manager);
  const end = manager.itemEnd.bind(manager);
  manager.itemStart = (u: string) => {
    pending++;
    start(u);
  };
  manager.itemEnd = (u: string) => {
    end(u);
    pending = Math.max(0, pending - 1);
    if (pending === 0) {
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    }
  };
  manager.setURLModifier((u) => {
    if (u.startsWith('blob:') || u.startsWith('data:')) return u;
    const hit = urls.get(base(u));
    if (hit) return hit;
    missing.add(base(u));
    return u;
  });
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  return {
    manager,
    missing,
    /** 等所有貼圖載入（或失敗）完成；最多等 timeoutMs */
    idle: (timeoutMs = 20000) =>
      new Promise<void>((res) => {
        const t = setTimeout(res, timeoutMs);
        const done = () => {
          clearTimeout(t);
          res();
        };
        // 讓 loader 有機會先排入請求
        setTimeout(() => (pending === 0 ? done() : waiters.push(done)), 0);
      }),
    dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

const text = (d: Uint8Array) => new TextDecoder().decode(d);
const buf = (d: Uint8Array) => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;

function meshFromGeometry(g: THREE.BufferGeometry): THREE.Object3D {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8d4cc,
    roughness: 0.7,
    vertexColors: !!g.getAttribute('color'),
  });
  return new THREE.Mesh(g, mat);
}

/** 非 PBR 材質（Phong／Lambert，FBX、OBJ、DAE 常見）→ MeshStandardMaterial，GLB 才保得住顏色與貼圖 */
function toStandard(m: THREE.Material): THREE.Material {
  if (
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
    (m as THREE.MeshBasicMaterial).isMeshBasicMaterial
  )
    return m;
  const src = m as THREE.MeshPhongMaterial;
  const shininess = typeof src.shininess === 'number' ? src.shininess : 30;
  const out = new THREE.MeshStandardMaterial({
    name: m.name,
    color: src.color ?? new THREE.Color(0xcccccc),
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    emissive: src.emissive ?? new THREE.Color(0),
    emissiveMap: src.emissiveMap ?? null,
    alphaMap: src.alphaMap ?? null,
    aoMap: src.aoMap ?? null,
    opacity: m.opacity,
    transparent: m.transparent,
    side: m.side,
    vertexColors: m.vertexColors,
    roughness: Math.max(0.05, Math.min(1, 1 - Math.sqrt(shininess / 200))),
    metalness: 0,
  });
  return out;
}

function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
  });
  return Math.round(n);
}

/** 解析主檔 → Object3D（尚未轉單位、轉正） */
export async function loadModelSource(input: readonly SourceFile[]): Promise<LoadedSource> {
  const files = expandFiles(input);
  const { file, format } = pickMainFile(files);
  const fm = fileManager(files);
  let root: THREE.Object3D;
  try {
    const d = file.data;
    switch (format) {
      case 'glb':
      case 'gltf': {
        const g = await new GLTFLoader(fm.manager).parseAsync(format === 'glb' ? buf(d) : text(d), '');
        root = g.scene;
        break;
      }
      case 'obj': {
        const src = text(d);
        const loader = new OBJLoader(fm.manager);
        const lib = /^\s*mtllib\s+(.+?)\s*$/m.exec(src)?.[1];
        const mtl =
          (lib && files.find((f) => base(f.name) === base(lib))) ?? files.find((f) => ext(f.name) === 'mtl');
        if (mtl) {
          const mats = new MTLLoader(fm.manager).parse(text(mtl.data), '');
          mats.preload();
          loader.setMaterials(mats);
        } else if (lib) fm.missing.add(base(lib));
        root = loader.parse(src);
        break;
      }
      case 'fbx':
        root = new FBXLoader(fm.manager).parse(buf(d), '');
        break;
      case 'dae': {
        const r = new ColladaLoader(fm.manager).parse(text(d), '');
        if (!r?.scene) throw new ModelImportError('UPLOAD_PARSE');
        root = r.scene;
        break;
      }
      case 'stl':
        root = meshFromGeometry(new STLLoader(fm.manager).parse(buf(d)));
        break;
      case 'ply':
        root = meshFromGeometry(new PLYLoader(fm.manager).parse(buf(d)));
        break;
      case '3ds':
        root = new TDSLoader(fm.manager).parse(buf(d), '');
        break;
      case '3mf':
        root = new ThreeMFLoader(fm.manager).parse(buf(d));
        break;
      case 'usdz':
        root = await new Promise<THREE.Object3D>((res, rej) => {
          const g = new USDZLoader(fm.manager).parse(buf(d), '', res, rej);
          if (g) setTimeout(() => res(g), 3000); // 舊版同步回傳
        });
        break;
      case 'wrl':
        root = new VRMLLoader(fm.manager).parse(text(d), '');
        break;
    }
    await fm.idle();
  } catch (e) {
    fm.dispose();
    if (e instanceof ModelImportError) throw e;
    throw new ModelImportError('UPLOAD_PARSE');
  }
  // 動畫骨架、燈、相機都不需要；材質統一成 PBR
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) drop.push(o);
    const m = o as THREE.Mesh;
    if (m.isMesh)
      m.material = Array.isArray(m.material) ? m.material.map(toStandard) : toStandard(m.material);
  });
  drop.forEach((o) => o.parent?.remove(o));
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  fm.dispose();
  if (box.isEmpty()) throw new ModelImportError('EMPTY_MODEL');
  const size = box.getSize(new THREE.Vector3());
  return {
    format,
    mainName: file.name,
    root,
    missing: [...fm.missing],
    suggestedUnit: format === 'glb' || format === 'gltf' ? 'm' : guessUnit(Math.max(size.x, size.y, size.z)),
    suggestedZUp: format === 'stl' || format === 'ply' || format === '3ds',
    triangles: countTriangles(root),
  };
}

/** 每個 mesh 依比例減面（meshoptimizer）；回傳減面後總三角形數 */
export async function simplifyObject(root: THREE.Object3D, ratio: number): Promise<number> {
  if (ratio >= 1) return countTriangles(root);
  await MeshoptSimplifier.ready;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    let g = m.geometry;
    if (!g.index) g = mergeVertices(g);
    const idx = g.index!.array as Uint32Array | Uint16Array;
    const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
    if (target >= idx.length) return;
    const pos = g.getAttribute('position');
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p[i * 3] = pos.getX(i);
      p[i * 3 + 1] = pos.getY(i);
      p[i * 3 + 2] = pos.getZ(i);
    }
    const r = MeshoptSimplifier.simplify(
      idx instanceof Uint32Array ? idx : new Uint32Array(idx),
      p,
      3,
      target,
      0.05,
    ) as unknown;
    const out = (Array.isArray(r) ? r[0] : r) as Uint32Array;
    const ng = g.clone();
    ng.setIndex(new THREE.BufferAttribute(out, 1));
    m.geometry = ng;
  });
  return countTriangles(root);
}

/**
 * 轉成 GLB：套用單位（→ 公尺，glTF 標準）與 Z-up → Y-up，貼圖內嵌。
 * 不修改 source.root（每次轉換複製一份，使用者可來回切換選項）。
 */
export async function toGlb(
  source: LoadedSource,
  opts: { unit: ModelUnit; zUp: boolean; maxTriangles?: number },
): Promise<{ bytes: ArrayBuffer; triangles: number }> {
  const root = source.root.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry = m.geometry.clone();
  });
  const wrap = new THREE.Group();
  wrap.add(root);
  const k = UNIT_M[opts.unit];
  root.scale.multiplyScalar(k);
  if (opts.zUp) root.rotation.x -= Math.PI / 2;
  let triangles = countTriangles(root);
  if (opts.maxTriangles && triangles > opts.maxTriangles)
    triangles = await simplifyObject(root, opts.maxTriangles / triangles);
  wrap.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const bytes = (await exporter.parseAsync(wrap, {
    binary: true,
    onlyVisible: true,
    embedImages: true,
    maxTextureSize: 2048,
  })) as ArrayBuffer;
  return { bytes, triangles };
}

/** File[]（input／拖放）→ SourceFile[] */
export async function readSourceFiles(files: readonly File[]): Promise<SourceFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

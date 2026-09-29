import { type Document, NodeIO, getBounds } from '@gltf-transform/core';
import type { CatalogEntry } from '@interiorai/catalog';

export interface IngestOptions {
  id: string;
  nameZh: string;
  category: CatalogEntry['category'];
  /** 宣稱的真實尺寸 mm（07 §2：bbox 與 dims 誤差 ≤ 2%） */
  dimsMm: { w: number; d: number; h: number };
  anchor?: CatalogEntry['anchor'];
  license?: CatalogEntry['license'];
  modelUrl: string;
}

export interface IngestIssue {
  severity: 'error' | 'warning';
  code: 'VALIDATOR' | 'DIMS_MISMATCH' | 'ORIGIN' | 'TRIANGLES' | 'LICENSE_MISSING';
  message: string;
}

export interface IngestResult {
  ok: boolean;
  issues: IngestIssue[];
  entry: CatalogEntry | null;
  measured: { wMm: number; dMm: number; hMm: number; triangles: number };
}

export const DIMS_TOLERANCE = 0.02;
export const MAX_TRIANGLES = 20_000; // B5〔假設〕

type Validator = {
  validateBytes(
    data: Uint8Array,
    opts?: object,
  ): Promise<{
    issues: { numErrors: number; messages: { code: string; message: string; severity: number }[] };
  }>;
};

/**
 * 匯入管線（07 §2）的檢查段：gltf-validator → 尺度/原點 → 面數 → 授權。
 * 轉 glTF、Draco/Meshopt、KTX2、LOD 與縮圖需要原生工具（toktx 等），P2 未實作，列於 PROGRESS。
 * 結果：通過者 status=draft（授權缺）或 review（授權齊）；**永不自動 published**（B5）。
 */
export async function ingestGlb(
  bytes: Uint8Array,
  opts: IngestOptions,
  validator?: Validator,
): Promise<IngestResult> {
  const issues: IngestIssue[] = [];
  const v: Validator = validator ?? (await import('gltf-validator'));
  try {
    const report = await v.validateBytes(bytes, { maxIssues: 50 });
    if (report.issues.numErrors > 0)
      for (const m of report.issues.messages.filter((x) => x.severity === 0).slice(0, 5))
        issues.push({ severity: 'error', code: 'VALIDATOR', message: `${m.code}: ${m.message}` });
  } catch (e) {
    issues.push({
      severity: 'error',
      code: 'VALIDATOR',
      message: `gltf-validator：${e instanceof Error ? e.message : String(e)}`,
    });
    return { ok: false, issues, entry: null, measured: { wMm: 0, dMm: 0, hMm: 0, triangles: 0 } };
  }

  let doc: Document;
  try {
    doc = await new NodeIO().readBinary(bytes);
  } catch (e) {
    issues.push({
      severity: 'error',
      code: 'VALIDATOR',
      message: `無法解析 glb：${e instanceof Error ? e.message : String(e)}`,
    });
    return { ok: false, issues, entry: null, measured: { wMm: 0, dMm: 0, hMm: 0, triangles: 0 } };
  }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  // glTF 單位為公尺（B5：1 單位 = 1 m，載入時轉 mm）
  const wMm = (bounds.max[0]! - bounds.min[0]!) * 1000;
  const hMm = (bounds.max[1]! - bounds.min[1]!) * 1000;
  const dMm = (bounds.max[2]! - bounds.min[2]!) * 1000;
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      triangles += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
    }

  const within = (measured: number, declared: number) =>
    Math.abs(measured - declared) <= declared * DIMS_TOLERANCE;
  for (const [k, m] of [
    ['w', wMm],
    ['d', dMm],
    ['h', hMm],
  ] as const)
    if (!within(m, opts.dimsMm[k]))
      issues.push({
        severity: 'error',
        code: 'DIMS_MISMATCH',
        message: `${k}：模型 ${Math.round(m)} mm 與宣稱 ${opts.dimsMm[k]} mm 差超過 2%（單位是否為公尺？）`,
      });

  // 原點＝底部中心（B5）：min.y ≈ 0、x/z 中心 ≈ 0（容差 1% 尺寸或 5mm）
  const cx = ((bounds.max[0]! + bounds.min[0]!) / 2) * 1000;
  const cz = ((bounds.max[2]! + bounds.min[2]!) / 2) * 1000;
  const minY = bounds.min[1]! * 1000;
  const tol = (n: number) => Math.max(5, n * 0.01);
  if (Math.abs(cx) > tol(wMm) || Math.abs(cz) > tol(dMm) || Math.abs(minY) > tol(hMm))
    issues.push({
      severity: 'error',
      code: 'ORIGIN',
      message: `原點應在底部中心：中心偏移 (${Math.round(cx)}, ${Math.round(minY)}, ${Math.round(cz)}) mm`,
    });
  if (triangles > MAX_TRIANGLES)
    issues.push({
      severity: 'warning',
      code: 'TRIANGLES',
      message: `三角形 ${triangles} 超過 ${MAX_TRIANGLES}，需提供 LOD1`,
    });
  if (!opts.license)
    issues.push({
      severity: 'warning',
      code: 'LICENSE_MISSING',
      message: '缺授權資料：只能以 draft 登錄，不得 published（B5）',
    });

  const ok = !issues.some((i) => i.severity === 'error');
  const entry: CatalogEntry | null = ok
    ? {
        id: opts.id,
        slug: opts.id.toLowerCase(),
        nameZh: opts.nameZh,
        category: opts.category,
        tags: [],
        styleTags: [],
        dimsMm: opts.dimsMm,
        anchor: opts.anchor ?? 'floor',
        model: { kind: 'glb', url: opts.modelUrl },
        materialSlots: [],
        ...(opts.license ? { license: opts.license } : {}),
        status: opts.license ? 'review' : 'draft',
      }
    : null;
  return { ok, issues, entry, measured: { wMm, dMm, hMm, triangles } };
}

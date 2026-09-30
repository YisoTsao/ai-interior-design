import { CatalogEntrySchema, MaterialSchema, type CatalogEntry, type Material } from './schema.js';

export interface Catalog {
  get(id: string): CatalogEntry | undefined;
  /** 只回 published（B5：未確認授權不得上架） */
  search(q?: { text?: string; category?: CatalogEntry['category'] }): CatalogEntry[];
  all(): CatalogEntry[];
  /** 執行期加入（使用者上傳的 3D 模型）；同 id 取代 */
  add(entry: CatalogEntry): void;
  remove(id: string): void;
  /** 內容版本：每次 add/remove 遞增（供 UI 重新整理） */
  version(): number;
  subscribe(fn: () => void): () => void;
}

export function createCatalog(initial: readonly CatalogEntry[]): Catalog {
  let entries = [...initial];
  const byId = new Map(entries.map((e) => [e.id, e]));
  let ver = 0;
  const subs = new Set<() => void>();
  const changed = () => {
    ver++;
    subs.forEach((f) => f());
  };
  return {
    get: (id) => byId.get(id),
    all: () => [...entries],
    add: (e) => {
      entries = [...entries.filter((x) => x.id !== e.id), e];
      byId.set(e.id, e);
      changed();
    },
    remove: (id) => {
      if (!byId.delete(id)) return;
      entries = entries.filter((x) => x.id !== id);
      changed();
    },
    version: () => ver,
    subscribe: (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    search: ({ text, category } = {}) => {
      const t = text?.trim().toLowerCase();
      return entries.filter(
        (e) =>
          e.status === 'published' &&
          (!category || e.category === category) &&
          (!t || [e.nameZh, e.nameEn ?? '', e.slug, ...e.tags].some((s) => s.toLowerCase().includes(t))),
      );
    },
  };
}

export interface CatalogIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
}

/** `pnpm catalog check` 的核心（07 §6、B5）：CI 阻擋不合格資產 */
export function checkCatalog(
  entries: readonly unknown[],
  materials: readonly unknown[] = [],
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const seen = new Set<string>();
  const matIds = new Set<string>();
  for (const raw of materials) {
    const r = MaterialSchema.safeParse(raw);
    const mid = (raw as { id?: string })?.id ?? '?';
    if (!r.success)
      issues.push({ id: mid, severity: 'error', message: `材質 schema：${r.error.issues[0]?.message}` });
    else matIds.add(r.data.id);
  }
  for (const raw of entries) {
    const rid = (raw as { id?: string })?.id ?? '?';
    const r = CatalogEntrySchema.safeParse(raw);
    if (!r.success) {
      issues.push({
        id: rid,
        severity: 'error',
        message: `schema：${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
      });
      continue;
    }
    const a = r.data;
    if (seen.has(a.id)) issues.push({ id: a.id, severity: 'error', message: 'id 重複' });
    seen.add(a.id);
    if (a.status === 'published' && !a.license)
      issues.push({ id: a.id, severity: 'error', message: '無授權資料不得 published（B5）' });
    if (a.status === 'published' && a.license && !a.license.allowedUse.includes('commercial'))
      issues.push({ id: a.id, severity: 'error', message: '授權不允許商用，不得 published' });
    if (!a.license) issues.push({ id: a.id, severity: 'warning', message: '缺授權資料，維持 draft' });
    if (a.model.kind === 'parametric') {
      for (const [k, p] of Object.entries(a.model.params)) {
        if (
          p.type === 'integer' &&
          typeof p.default === 'number' &&
          ((p.min ?? -Infinity) > p.default || (p.max ?? Infinity) < p.default)
        )
          issues.push({ id: a.id, severity: 'error', message: `參數 ${k} 預設值超出範圍` });
        if (p.type === 'enum' && !(p.values ?? []).includes(String(p.default)))
          issues.push({ id: a.id, severity: 'error', message: `參數 ${k} 預設值不在選項內` });
      }
    }
    for (const s of a.materialSlots)
      if (matIds.size && !matIds.has(s.defaultMaterialId))
        issues.push({
          id: a.id,
          severity: 'error',
          message: `材質槽 ${s.name} 指向不存在的材質 ${s.defaultMaterialId}`,
        });
  }
  return issues;
}

export function materialMap(materials: readonly Material[]): Map<string, Material> {
  return new Map(materials.map((m) => [m.id, m]));
}

/** 解析參數：取預設值並以使用者值覆寫（夾在範圍內） */
export function resolveParams(
  entry: CatalogEntry,
  overrides: Record<string, unknown> = {},
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (entry.model.kind !== 'parametric') return out;
  for (const [k, p] of Object.entries(entry.model.params)) {
    const v = overrides[k];
    if (p.type === 'integer') {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : (p.default as number);
      out[k] = Math.min(p.max ?? n, Math.max(p.min ?? n, n));
    } else {
      out[k] = typeof v === 'string' && (p.values ?? []).includes(v) ? v : String(p.default);
    }
  }
  return out;
}

/** 物件實際尺寸：參數化模組優先用 w/d/h 參數，再乘上 scale */
export function objectDims(
  entry: CatalogEntry,
  params: Record<string, unknown> = {},
  scale: readonly number[] = [1, 1, 1],
) {
  const r = resolveParams(entry, params);
  const num = (k: 'w' | 'd' | 'h') => (typeof r[k] === 'number' ? (r[k] as number) : entry.dimsMm[k]);
  return { w: num('w') * (scale[0] ?? 1), h: num('h') * (scale[1] ?? 1), d: num('d') * (scale[2] ?? 1) };
}

/** 放置時的離地高度：天花物件貼天花；壁掛物用目錄預設 elevationMm；其餘落地 */
export function defaultElevation(
  entry: CatalogEntry,
  levelHeight: number,
  params: Record<string, unknown> = {},
  scale?: readonly number[],
): number {
  if (entry.anchor === 'ceiling') return levelHeight - objectDims(entry, params, scale).h;
  return Math.min(entry.elevationMm ?? 0, Math.max(0, levelHeight - objectDims(entry, params, scale).h));
}

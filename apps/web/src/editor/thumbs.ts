import { useEffect, useState } from 'react';
import { materialMap, type CatalogEntry } from '@interiorai/catalog';
import { cachedThumbnail, catalogThumbnail, catalogTopView, modelThumbnail } from '@interiorai/viewer-3d';
import { catalog, materials } from '../catalogData';

const lib = materialMap(materials);
const waiting = new Map<string, { entry: CatalogEntry; subs: Set<(u: string | null) => void> }>();
let scheduled = false;

/** 每個閒置時段只渲染幾張，避免打開資產庫時卡頓 */
function pump() {
  scheduled = false;
  const t0 = performance.now();
  for (const [id, job] of waiting) {
    if (performance.now() - t0 > 12) break;
    waiting.delete(id);
    if (job.entry.model.kind === 'glb') {
      void modelThumbnail(job.entry).then(
        (u) => job.subs.forEach((f) => f(u)),
        () => job.subs.forEach((f) => f(null)),
      );
    } else {
      let u: string | null = null;
      try {
        u = catalogThumbnail(job.entry, lib);
      } catch {
        u = null;
      }
      job.subs.forEach((f) => f(u));
    }
  }
  if (waiting.size) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(pump);
  else setTimeout(pump, 16);
}

/** 資產縮圖（離屏 three.js 即時渲染、快取）；尚未完成時回傳 undefined */
export function useThumbnail(entry: CatalogEntry | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() =>
    entry ? cachedThumbnail(entry.id) : undefined,
  );
  useEffect(() => {
    if (!entry) return;
    const hit = cachedThumbnail(entry.id);
    if (hit) return setUrl(hit);
    let alive = true;
    const job = waiting.get(entry.id) ?? { entry, subs: new Set() };
    const sub = (u: string | null) => alive && setUrl(u);
    job.subs.add(sub);
    waiting.set(entry.id, job);
    schedule();
    return () => {
      alive = false;
      job.subs.delete(sub);
    };
  }, [entry]);
  return url;
}

/**
 * 2D 家具俯視縮圖（FE-PLAN-12）：場景用到的品項逐一渲染俯視圖（離屏、快取），完成一批就更新。
 * enabled＝false 時回傳空 Map（2D 畫符號）。
 */
export function useTopViews(catalogIds: readonly string[], enabled: boolean): ReadonlyMap<string, string> {
  const [map, setMap] = useState<ReadonlyMap<string, string>>(new Map());
  const key = enabled ? [...new Set(catalogIds)].sort().join('|') : '';
  useEffect(() => {
    if (!key) return setMap(new Map());
    let alive = true;
    void (async () => {
      const out = new Map<string, string>();
      for (const id of key.split('|')) {
        const e = catalog.get(id);
        if (
          !e ||
          (e.model.kind === 'parametric' && ['door', 'window', 'mep', 'stairs'].includes(e.model.type))
        )
          continue;
        try {
          const u = await catalogTopView(e, lib);
          if (u) out.set(id, u);
        } catch {
          /* 模型載入失敗：畫符號 */
        }
        if (!alive) return;
      }
      setMap(out);
    })();
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

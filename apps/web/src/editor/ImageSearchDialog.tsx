import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus } from 'lucide-react';
import { materialMap, type CatalogEntry } from '@interiorai/catalog';
import { cachedThumbnail, catalogThumbnail, modelThumbnail } from '@interiorai/viewer-3d';
import { describe, rank, type ImageDescriptor } from '../ai/imageSearch';
import { catalog, materials } from '../catalogData';
import { useEditorStore } from './context';
import { HudDialog } from './HudDialog';

const lib = materialMap(materials);
const descCache = new Map<string, ImageDescriptor>();

async function pixels(
  src: string | Blob,
  max = 200,
): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/** 以圖找物（FE-AST-09）：上傳家具照片 → 依色彩與比例找相似資產 → 點選進入放置 */
export function ImageSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<{ item: CatalogEntry; score: number }[]>([]);
  useEffect(() => {
    if (open) return;
    if (photo) URL.revokeObjectURL(photo);
    setPhoto(null);
    setResults([]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: File | undefined) => {
    if (!f) return;
    setPhoto(URL.createObjectURL(f));
    setBusy(t('imageSearch.reading'));
    const p = await pixels(f);
    const q = describe(p.data, p.w, p.h, 'border');
    const entries = catalog
      .all()
      .filter((e) => e.status === 'published' && !['openings', 'structure', 'mep'].includes(e.category));
    const items: { item: CatalogEntry; d: ImageDescriptor }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      let d = descCache.get(e.id);
      if (!d) {
        const url =
          cachedThumbnail(e.id) ??
          (e.model.kind === 'glb' ? await modelThumbnail(e).catch(() => null) : catalogThumbnail(e, lib));
        if (!url) continue;
        const px = await pixels(url, 160);
        d = describe(px.data, px.w, px.h, 'alpha');
        descCache.set(e.id, d);
      }
      items.push({ item: e, d });
      if (i % 10 === 0) setBusy(t('imageSearch.indexing', { n: i, total: entries.length }));
    }
    setResults(rank(q, items, 12));
    setBusy(null);
  };
  const pick = (e: CatalogEntry) => {
    const s = store.getState();
    if (s.view !== '2d') s.setView('2d');
    s.setTool('place', e.id);
    onOpenChange(false);
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('imageSearch.title')}
      testId="image-search"
      width={760}
    >
      <div className="grid gap-3 md:grid-cols-[200px_1fr]">
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-border text-xs text-muted hover:border-primary">
          {photo ? (
            <img src={photo} alt={t('imageSearch.photo')} className="h-full w-full object-contain" />
          ) : (
            <>
              <ImagePlus size={24} aria-hidden className="text-primary" />
              {t('imageSearch.pick')}
            </>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => void run(e.target.files?.[0])}
            data-testid="image-search-file"
          />
        </label>
        <div className="space-y-2">
          {busy && <p className="text-xs text-muted">{busy}</p>}
          <ul className="grid grid-cols-3 gap-2" data-testid="image-search-results">
            {results.map(({ item, score }) => (
              <li key={item.id}>
                <button
                  className="inv-slot flex w-full flex-col items-center gap-1 p-1 text-[11px]"
                  onClick={() => pick(item)}
                >
                  <img src={cachedThumbnail(item.id) ?? ''} alt="" className="h-20 w-20 object-contain" />
                  <span className="truncate">
                    {i18n.language === 'en' ? (item.nameEn ?? item.nameZh) : item.nameZh}
                  </span>
                  <span className="font-mono text-accent">
                    {t('imageSearch.score', { n: Math.round(score * 100) })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted">{t('imageSearch.note')}</p>
        </div>
      </div>
    </HudDialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Paintbrush, Sparkles, X } from 'lucide-react';
import { activeLevel, batch, updateWall } from '@interiorai/app-state';
import { materialMap } from '@interiorai/catalog';
import { catalog, useMaterials } from '../catalogData';
import { extractPalette, imagePixels, inferStyles, recommendAssets, type Swatch } from '../ai/moodboard';
import { getMoodboard, setMoodboard } from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';
import { useThumbnail } from './thumbs';
import type { CatalogEntry } from '@interiorai/catalog';
import { dragPayload } from './dragPayload';

/**
 * 風格探索／情境板（FE-AI-06）：拖入參考圖 → 主色盤、風格標籤（信心分數）→ 推薦資產（可拖到畫面或點選放置）；
 * 色盤可一鍵套用到選取的牆（兩面）。
 */
export function MoodboardPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const materials = useMaterials();
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (open) void getMoodboard(projectId).then(setBlobs);
  }, [open, projectId]);
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  useEffect(() => {
    let dead = false;
    void (async () => {
      const all: number[] = [];
      for (const b of blobs) all.push(...(await imagePixels(b)));
      if (!dead) setPalette(extractPalette(all, 6));
    })();
    return () => {
      dead = true;
    };
  }, [blobs]);
  const styles = useMemo(() => inferStyles(palette), [palette]);
  const recs = useMemo(
    () =>
      recommendAssets(
        catalog.all(),
        materialMap(materials),
        palette,
        styles.slice(0, 2).map((s) => s.style),
      ),
    [palette, styles, materials],
  );
  const add = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const next = [...blobs, ...imgs].slice(0, 24);
    setBlobs(next);
    await setMoodboard(projectId, next);
  };
  const remove = async (i: number) => {
    const next = blobs.filter((_, k) => k !== i);
    setBlobs(next);
    await setMoodboard(projectId, next);
  };
  const paintWalls = (hex: string) => {
    const s = store.getState();
    const lv = activeLevel(s);
    const walls = lv.walls.filter((w) => s.selection.includes(w.id));
    if (!walls.length) return s.notify('info', t('mood.selectWalls'));
    s.exec(
      batch(
        walls.map((w) =>
          updateWall(lv.id, w.id, {
            appearance: { ...w.appearance, color: hex },
            appearanceB: { ...w.appearanceB, color: hex },
          }),
        ),
        'command.updateWall',
      ),
    );
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('mood.title')}
      side="right"
      width={460}
      testId="moodboard"
    >
      <div
        className={`space-y-3 ${over ? 'outline-2 outline-primary outline-dashed' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
      >
        <p className="text-xs text-muted">{t('mood.desc')}</p>
        <div className="grid grid-cols-4 gap-1" data-testid="mood-images">
          {urls.map((u, i) => (
            <div key={u} className="relative aspect-square overflow-hidden rounded">
              <img src={u} alt="" className="h-full w-full object-cover" />
              <button
                className="absolute top-0.5 right-0.5 rounded bg-black/60 p-0.5"
                onClick={() => void remove(i)}
                aria-label={t('mood.remove')}
              >
                <X size={10} aria-hidden />
              </button>
            </div>
          ))}
          <label className="grid aspect-square cursor-pointer place-items-center rounded border border-dashed border-border text-muted hover:text-primary">
            <ImagePlus size={18} aria-hidden />
            <span className="sr-only">{t('mood.add')}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              data-testid="mood-file"
              onChange={(e) => {
                if (e.target.files) void add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {palette.length > 0 && (
          <>
            <section>
              <h3 className="mb-1 text-xs font-bold text-primary">{t('mood.palette')}</h3>
              <div className="flex h-12 overflow-hidden rounded" data-testid="mood-palette">
                {palette.map((s) => (
                  <button
                    key={s.hex}
                    className="group relative h-full"
                    style={{ background: s.hex, width: `${Math.max(8, s.weight * 100)}%` }}
                    title={`${s.hex} · ${Math.round(s.weight * 100)}% — ${t('mood.paint')}`}
                    onClick={() => paintWalls(s.hex)}
                    data-hex={s.hex}
                  >
                    <Paintbrush
                      size={12}
                      className="absolute right-1 bottom-1 opacity-0 group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted">{t('mood.paintHint')}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-bold text-primary">{t('mood.styles')}</h3>
              <ul className="space-y-1 text-xs" data-testid="mood-styles">
                {styles.slice(0, 4).map((s) => (
                  <li key={s.style} className="flex items-center gap-2">
                    <span className="w-20">{t(`assets.styles.${s.style}`, { defaultValue: s.style })}</span>
                    <span className="h-1.5 flex-1 rounded bg-border">
                      <span
                        className="block h-full rounded bg-primary"
                        style={{ width: `${s.score * 100}%` }}
                      />
                    </span>
                    <span className="w-8 text-right font-mono">{Math.round(s.score * 100)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 flex items-center gap-1 text-xs font-bold text-primary">
                <Sparkles size={12} aria-hidden /> {t('mood.recommend')}
              </h3>
              <ul className="grid grid-cols-3 gap-1" data-testid="mood-recs">
                {recs.map((e) => (
                  <Rec key={e.id} e={e} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </HudDialog>
  );
}

function Rec({ e }: { e: CatalogEntry }) {
  const { i18n, t } = useTranslation();
  const store = useEditorStore();
  const thumb = useThumbnail(e);
  const nm = i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh;
  return (
    <li>
      <button
        className="inv-slot w-full p-1"
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData('application/x-interiorai-catalog', e.id);
          dragPayload.start({ kind: 'catalog', id: e.id });
        }}
        onDragEnd={dragPayload.end}
        onClick={() => {
          const s = store.getState();
          if (s.view === '3d') s.setView('2d');
          s.setTool('place', e.id);
        }}
        title={t('assets.place', { name: nm })}
      >
        <span className="block h-16 w-full overflow-hidden" aria-hidden>
          {thumb && <img src={thumb} alt="" draggable={false} className="h-full w-full object-contain" />}
        </span>
        <span className="line-clamp-1 text-[10px]">{nm}</span>
      </button>
    </li>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { activeLevel, projectInfoOf } from '@interiorai/app-state';
import { ROOM_KIND_FILL } from '@interiorai/editor-2d';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { catalog } from '../catalogData';
import {
  layoutSheet,
  paperSize,
  type LayoutTemplate,
  type Orientation,
  type Paper,
  type Viewport,
} from '../export/layout';
import { planToSvg } from '../export/plan';
import { listGallery, type GalleryItem } from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

const blobUrl = (b: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(b);
  });

type Source = 'plan' | 'furniture' | 'view3d' | `g:${string}` | 'none';

/** 圖紙版面（FE-DOC-06）：紙張、版型、每格內容與比例、圖簽 → 預覽 → 列印／存 PDF */
export function LayoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const projectName = useEditor((s) => s.projectName);
  const scene = useEditor((s) => s.scene);
  const level = useEditor(activeLevel);
  const info = projectInfoOf(scene);
  const [paper, setPaper] = useState<Paper>('A3');
  const [orient, setOrient] = useState<Orientation>('landscape');
  const [tpl, setTpl] = useState<LayoutTemplate>('two');
  const [sources, setSources] = useState<Source[]>(['plan', 'view3d', 'none', 'none']);
  const [scales, setScales] = useState<number[]>([100, 100, 100, 100]);
  const [drawing, setDrawing] = useState('');
  const [sheet, setSheet] = useState('A-01');
  const [designer, setDesigner] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void listGallery(projectId).then(setGallery);
    // 3D 透視：開啟時擷取一次目前視角（需在 3D 檢視）
    setShot(viewer3dApi.get()?.capture({ width: 1600, height: 1000 }) ?? null);
    setDrawing((d) => d || t('layout.defaultTitle'));
  }, [open, projectId, t]);
  useEffect(() => {
    for (const s of sources)
      if (s.startsWith('g:') && !images[s]) {
        const it = gallery.find((g) => `g:${g.id}` === s);
        if (it) void blobUrl(it.blob).then((u) => setImages((m) => ({ ...m, [s]: u })));
      }
  }, [sources, gallery, images]);
  const n = tpl === 'single' ? 1 : tpl === 'two' ? 2 : 4;
  const nameOf = (id: string) => {
    const e = catalog.get(id);
    return (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? id;
  };
  const viewports: Viewport[] = useMemo(
    () =>
      sources.slice(0, n).flatMap((s, i): Viewport[] => {
        if (s === 'plan' || s === 'furniture')
          return level.walls.length
            ? [
                {
                  kind: 'plan',
                  src: planToSvg(level, catalog, {
                    nameOf,
                    roomFill: (k) => ROOM_KIND_FILL[k ?? 'other'] ?? '#eee',
                    furniture: s === 'furniture',
                    dims: true,
                  }),
                  title: t(s === 'plan' ? 'layout.src.plan' : 'layout.src.furniture'),
                  scale: scales[i] ?? 100,
                },
              ]
            : [];
        if (s === 'view3d')
          return shot ? [{ kind: 'image', src: shot, title: t('layout.src.view3d'), scale: 0 }] : [];
        if (s.startsWith('g:') && images[s])
          return [
            {
              kind: 'image',
              src: images[s]!,
              title: gallery.find((g) => `g:${g.id}` === s)?.name ?? '',
              scale: 0,
            },
          ];
        return [];
      }),
    [sources, scales, n, level, shot, images, gallery, t], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const html = useMemo(
    () =>
      layoutSheet({
        paper,
        orientation: orient,
        template: tpl,
        viewports,
        title: {
          project: projectName,
          drawing,
          client: info.client,
          designer,
          sheet,
          date: new Date().toLocaleDateString(),
          labels: {
            project: t('layout.tb.project'),
            drawing: t('layout.tb.drawing'),
            client: t('layout.tb.client'),
            designer: t('layout.tb.designer'),
            scale: t('layout.tb.scale'),
            sheet: t('layout.tb.sheet'),
            date: t('layout.tb.date'),
          },
        },
      }),
    [paper, orient, tpl, viewports, projectName, drawing, info.client, designer, sheet, t],
  );
  const [W, H] = paperSize(paper, orient);
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return store.getState().notify('warn', t('layout.popupBlocked'));
    w.document.write(
      html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>print(),400)</script></body>'),
    );
    w.document.close();
  };
  const sel = (i: number) => (
    <select
      className="field min-w-0 flex-1"
      value={sources[i]}
      onChange={(e) => setSources(sources.map((x, j) => (j === i ? (e.target.value as Source) : x)))}
      data-testid={`layout-src-${i}`}
    >
      <option value="none">{t('layout.src.none')}</option>
      <option value="plan">{t('layout.src.plan')}</option>
      <option value="furniture">{t('layout.src.furniture')}</option>
      <option value="view3d" disabled={!shot}>
        {t('layout.src.view3d')}
      </option>
      {gallery.map((g) => (
        <option key={g.id} value={`g:${g.id}`}>
          {g.name}
        </option>
      ))}
    </select>
  );
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('layout.title')}
      testId="layout-dialog"
      width={1100}
      footer={
        <button className="btn btn-primary" onClick={print} data-testid="layout-print">
          <Printer size={14} aria-hidden /> {t('layout.print')}
        </button>
      }
    >
      <div className="grid gap-3 md:grid-cols-[280px_1fr]">
        <div className="space-y-2 text-xs">
          <div className="flex gap-1">
            <select
              className="field flex-1"
              value={paper}
              onChange={(e) => setPaper(e.target.value as Paper)}
              data-testid="layout-paper"
            >
              {(['A3', 'A4'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="field flex-1"
              value={orient}
              onChange={(e) => setOrient(e.target.value as Orientation)}
            >
              <option value="landscape">{t('layout.landscape')}</option>
              <option value="portrait">{t('layout.portrait')}</option>
            </select>
          </div>
          <div className="hud-seg">
            {(['single', 'two', 'four'] as const).map((x) => (
              <button
                key={x}
                aria-pressed={tpl === x}
                onClick={() => setTpl(x)}
                data-testid={`layout-tpl-${x}`}
              >
                {t(`layout.tpl.${x}`)}
              </button>
            ))}
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="w-4 font-mono text-accent">{i + 1}</span>
              {sel(i)}
              {(sources[i] === 'plan' || sources[i] === 'furniture') && (
                <select
                  className="field w-20"
                  value={scales[i]}
                  onChange={(e) => setScales(scales.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                  aria-label={t('layout.tb.scale')}
                  data-testid={`layout-scale-${i}`}
                >
                  {[50, 100, 200, 0].map((s) => (
                    <option key={s} value={s}>
                      {s ? `1:${s}` : t('layout.fit')}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <label className="grid gap-1">
            <span>{t('layout.tb.drawing')}</span>
            <input className="field" value={drawing} onChange={(e) => setDrawing(e.target.value)} />
          </label>
          <div className="flex gap-1">
            <label className="grid flex-1 gap-1">
              <span>{t('layout.tb.sheet')}</span>
              <input className="field" value={sheet} onChange={(e) => setSheet(e.target.value)} />
            </label>
            <label className="grid flex-1 gap-1">
              <span>{t('layout.tb.designer')}</span>
              <input className="field" value={designer} onChange={(e) => setDesigner(e.target.value)} />
            </label>
          </div>
          <p className="text-[11px] text-muted">{t('layout.hint')}</p>
        </div>
        <div className="grid place-items-center bg-black/30 p-2">
          <div style={{ width: `${W * 0.42}mm`, height: `${H * 0.42}mm`, overflow: 'hidden' }}>
            <iframe
              title={t('layout.preview')}
              srcDoc={html}
              className="border-0 bg-white"
              style={{
                width: `${W}mm`,
                height: `${H}mm`,
                transform: 'scale(0.42)',
                transformOrigin: 'top left',
              }}
              data-testid="layout-preview"
            />
          </div>
        </div>
      </div>
    </HudDialog>
  );
}

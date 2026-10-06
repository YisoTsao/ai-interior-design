import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, FileCode2, FileImage, Image as ImageIcon, Map as MapIcon, Package } from 'lucide-react';
import { activeLevel } from '@interiorai/app-state';
import { plan2dApi } from '@interiorai/editor-2d';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { catalog, useMaterials } from '../catalogData';
import { planToDxf, planToSvg } from '../export/plan';
import { drawingSet } from '../export/drawings';
import { materialMap } from '@interiorai/catalog';
import { addToGallery, dataUrlToBlob, download } from '../media';
import { exportProjectFile, PROJECT_EXT } from '../projectFile';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

const RES = { hd: [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] } as const;
type Res = keyof typeof RES;
/** 房間填色（依用途） */
const ROOM_FILL: Record<string, string> = {
  living: '#f5ead7',
  dining: '#f7e3cf',
  bedroom: '#e3ecf5',
  kitchen: '#e8f1e1',
  bath: '#dff0f2',
  study: '#eee6f4',
  entry: '#f0ece4',
  balcony: '#e6efe0',
};

/**
 * 匯出（FE-DOC-04／FE-RND-07／FE-RND-08）：DXF／SVG／PNG 平面圖、GLB／OBJ 模型、2K／4K 高解析截圖（可去背）、
 * 俯視彩色平面圖、專案檔。
 */
export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const view = useEditor((s) => s.view);
  const name = useEditor((s) => s.projectName) || 'interiorai';
  const projectId = useEditor((s) => s.projectId);
  const [res, setRes] = useState<Res>('2k');
  const [transparent, setTransparent] = useState(false);
  const [toGallery, setToGallery] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const level = () => activeLevel(store.getState());
  const materials = useMaterials();
  const nameOf = (id: string) => {
    const e = catalog.get(id);
    return e ? (i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh) : id;
  };
  const run = async (key: string, f: () => Promise<void> | void) => {
    setBusy(key);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await f();
    } catch (e) {
      store
        .getState()
        .notify('error', t('exports.failed', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };
  const saveImage = async (url: string, file: string, kind: 'screenshot' | 'plan') => {
    download(url, file);
    if (toGallery)
      await addToGallery(projectId, {
        kind,
        name: file.replace(/\.png$/, ''),
        blob: await dataUrlToBlob(url),
      });
  };
  const [w, h] = RES[res];
  const btn = (
    key: string,
    icon: React.ReactNode,
    label: string,
    f: () => Promise<void> | void,
    disabled = false,
  ) => (
    <button
      className="btn justify-start"
      disabled={disabled || !!busy}
      onClick={() => void run(key, f)}
      data-testid={`export-${key}`}
    >
      {icon} {busy === key ? t('exports.working') : label}
    </button>
  );
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('exports.title')}
      testId="export-dialog"
      width={620}
    >
      <div className="space-y-4 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-bold text-primary">{t('exports.plan')}</h3>
          <div className="grid grid-cols-3 gap-2">
            {btn('dxf', <FileCode2 size={14} aria-hidden />, 'DXF', () =>
              download(new Blob([planToDxf(level(), catalog)], { type: 'image/vnd.dxf' }), `${name}.dxf`),
            )}
            {btn('svg', <FileImage size={14} aria-hidden />, 'SVG', () =>
              download(
                new Blob(
                  [
                    planToSvg(level(), catalog, {
                      nameOf,
                      title: name,
                      roomFill: (k) => ROOM_FILL[k ?? ''] ?? '#f3efe7',
                    }),
                  ],
                  { type: 'image/svg+xml' },
                ),
                `${name}.svg`,
              ),
            )}
            {btn(
              'plan-png',
              <MapIcon size={14} aria-hidden />,
              'PNG',
              async () => {
                const url = plan2dApi.get()?.snapshot(4000);
                if (url) await saveImage(url, `${name}-plan.png`, 'plan');
              },
              view !== '2d',
            )}
          </div>
          {view !== '2d' && <p className="mt-1 text-[11px] text-muted">{t('exports.needs2d')}</p>}
          <div className="mt-2">
            {btn('drawings', <FileCode2 size={14} aria-hidden />, t('exports.drawings'), () => {
              const mats = materialMap(materials);
              const html = drawingSet(
                level(),
                catalog,
                mats,
                {
                  t: (k, v) => t(k, v),
                  nameOf,
                  matName: (id) => {
                    const m = mats.get(id);
                    return m ? (i18n.language === 'en' ? (m.nameEn ?? m.nameZh) : m.nameZh) : '—';
                  },
                  date: new Date().toLocaleDateString(i18n.language),
                },
                name,
              );
              const w = window.open('', '_blank');
              if (!w) return download(new Blob([html], { type: 'text/html' }), `${name}-drawings.html`);
              w.document.write(html);
              w.document.close();
            })}
            <p className="mt-1 text-[11px] text-muted">{t('exports.drawingsHint')}</p>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-bold text-primary">{t('exports.image')}</h3>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="hud-seg" role="radiogroup" aria-label={t('exports.resolution')}>
              {(Object.keys(RES) as Res[]).map((r) => (
                <button key={r} aria-pressed={res === r} onClick={() => setRes(r)}>
                  {`${r.toUpperCase()} ${RES[r][0]}×${RES[r][1]}`}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />
              {t('exports.transparent')}
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={toGallery} onChange={(e) => setToGallery(e.target.checked)} />
              {t('exports.toGallery')}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {btn(
              'shot',
              <ImageIcon size={14} aria-hidden />,
              t('exports.screenshot'),
              async () => {
                const url = viewer3dApi.get()?.capture({ width: w, height: h, transparent });
                if (url) await saveImage(url, `${name}-${res}.png`, 'screenshot');
              },
              view !== '3d',
            )}
            {btn(
              'topplan',
              <MapIcon size={14} aria-hidden />,
              t('exports.topPlan'),
              async () => {
                const url = viewer3dApi.get()?.topPlan({ width: w, height: h });
                if (url) await saveImage(url, `${name}-top.png`, 'plan');
              },
              view !== '3d',
            )}
          </div>
          {view !== '3d' && <p className="mt-1 text-[11px] text-muted">{t('exports.needs3d')}</p>}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-bold text-primary">{t('exports.model')}</h3>
          <div className="grid grid-cols-3 gap-2">
            {(['glb', 'obj'] as const).map((f) =>
              btn(
                f,
                <Box size={14} aria-hidden />,
                f.toUpperCase(),
                async () => {
                  const blob = await viewer3dApi.get()?.exportModel(f);
                  if (blob) download(blob, `${name}.${f}`);
                },
                view !== '3d',
              ),
            )}
            {btn('project', <Package size={14} aria-hidden />, PROJECT_EXT, async () =>
              download(await exportProjectFile(store.getState().scene, name), `${name}${PROJECT_EXT}`),
            )}
          </div>
        </section>
      </div>
    </HudDialog>
  );
}

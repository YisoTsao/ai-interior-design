import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Download, Globe2, ImageIcon, SlidersHorizontal, Star, Trash2, X } from 'lucide-react';
import { PhotoEditor } from './PhotoEditor';
import { plan2dApi } from '@interiorai/editor-2d';
import { PanoramaViewer, viewer3dApi } from '@interiorai/viewer-3d';
import {
  addToGallery,
  dataUrlToBlob,
  download,
  listGallery,
  removeFromGallery,
  setProjectThumb,
  shrink,
  type GalleryItem,
} from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/** 擷取 720° 全景並存入圖庫（3D 視圖才有） */
export async function capturePanorama(projectId: string, name: string): Promise<GalleryItem | null> {
  const url = viewer3dApi.get()?.panorama({ width: 4096 });
  if (!url) return null;
  return addToGallery(projectId, {
    kind: 'panorama',
    name,
    blob: await dataUrlToBlob(url),
    width: 4096,
    height: 2048,
  });
}

/**
 * 圖庫（FE-RND-04）：截圖、720° 全景（FE-RND-02）、平面圖、AI 渲染結果；檢視（全景用球面檢視器）、下載、設為封面、刪除。
 */
export function GalleryPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const view = useEditor((s) => s.view);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<GalleryItem['kind'] | 'all'>('all');
  const refresh = () => listGallery(projectId).then(setItems);
  useEffect(() => {
    if (open) void refresh();
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const urls = useMemo(() => new Map(items.map((i) => [i.id, URL.createObjectURL(i.blob)])), [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const stamp = () => new Date().toLocaleString(i18n.language);
  const snap = async () => {
    const url = view === '3d' ? viewer3dApi.get()?.screenshot() : plan2dApi.get()?.snapshot(2400);
    if (!url) return;
    await addToGallery(projectId, {
      kind: view === '3d' ? 'screenshot' : 'plan',
      name: `${t(view === '3d' ? 'gallery.kind.screenshot' : 'gallery.kind.plan')} ${stamp()}`,
      blob: await dataUrlToBlob(url),
    });
    void refresh();
  };
  const pano = async () => {
    setBusy(true);
    try {
      // 讓「處理中」先畫出來
      await new Promise((r) => setTimeout(r, 30));
      const it = await capturePanorama(projectId, `${t('gallery.kind.panorama')} ${stamp()}`);
      if (it) {
        await refresh();
        setViewing(it);
      }
    } finally {
      setBusy(false);
    }
  };
  const cover = async (it: GalleryItem) => {
    const u = urls.get(it.id);
    if (!u) return;
    await setProjectThumb(projectId, await shrink(u, 640));
    store.getState().notify('info', t('gallery.coverSet'));
  };
  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter);

  return (
    <HudDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setViewing(null);
      }}
      title={t('gallery.title')}
      testId="gallery-panel"
      width={viewing ? 1100 : 860}
    >
      {viewing ? (
        <div className="flex h-[70vh] flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              className="btn"
              onClick={() => {
                setViewing(null);
                setEditing(false);
              }}
            >
              <X size={14} aria-hidden /> {t('gallery.back')}
            </button>
            <span className="flex-1 truncate text-sm">{viewing.name}</span>
            {viewing.kind !== 'panorama' && (
              <button
                className="btn"
                aria-pressed={editing}
                onClick={() => setEditing(!editing)}
                data-testid="photo-edit"
              >
                <SlidersHorizontal size={14} aria-hidden /> {t('photo.edit')}
              </button>
            )}
            <button
              className="btn"
              onClick={() =>
                download(viewing.blob, `${viewing.name}.${viewing.kind === 'panorama' ? 'jpg' : 'png'}`)
              }
            >
              <Download size={14} aria-hidden /> {t('gallery.download')}
            </button>
          </div>
          {viewing.kind === 'panorama' ? (
            <>
              <PanoramaViewer
                src={urls.get(viewing.id)!}
                className="min-h-0 flex-1 overflow-hidden rounded"
              />
              <p className="text-xs text-muted">{t('gallery.panoHint')}</p>
            </>
          ) : editing ? (
            <PhotoEditor
              src={urls.get(viewing.id)!}
              blob={viewing.blob}
              onSave={async (b) => {
                const it = await addToGallery(projectId, {
                  kind: viewing.kind,
                  name: `${viewing.name} · ${t('photo.edited')}`,
                  blob: b,
                });
                await refresh();
                setEditing(false);
                setViewing(it);
              }}
            />
          ) : (
            <img
              src={urls.get(viewing.id)}
              alt={viewing.name}
              className="min-h-0 flex-1 rounded object-contain"
            />
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => void snap()} data-testid="gallery-snap">
              <Camera size={14} aria-hidden /> {t('gallery.snap')}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void pano()}
              disabled={view !== '3d' || busy}
              title={view !== '3d' ? t('gallery.pano3dOnly') : undefined}
              data-testid="gallery-pano"
            >
              <Globe2 size={14} aria-hidden /> {busy ? t('gallery.rendering') : t('gallery.pano')}
            </button>
            <select
              className="field ml-auto w-36"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              aria-label={t('gallery.filter')}
            >
              {(['all', 'screenshot', 'panorama', 'render', 'plan'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(k === 'all' ? 'gallery.all' : `gallery.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          {shown.length === 0 ? (
            <div className="grid place-items-center gap-2 p-12 text-center text-muted">
              <ImageIcon size={32} aria-hidden />
              <p className="text-sm">{t('gallery.empty')}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="gallery-grid">
              {shown.map((it) => (
                <li key={it.id} className="inv-slot overflow-hidden p-0" data-kind={it.kind}>
                  <button className="block w-full" onClick={() => setViewing(it)} aria-label={it.name}>
                    <img src={urls.get(it.id)} alt="" className="aspect-video w-full object-cover" />
                  </button>
                  <div className="flex items-center gap-1 p-1.5">
                    <span className="inv-badge static">{t(`gallery.kind.${it.kind}`)}</span>
                    <span className="flex-1 truncate text-[11px] text-muted">
                      {new Date(it.createdAt).toLocaleString(i18n.language)}
                    </span>
                    <button className="icon-btn" title={t('gallery.cover')} onClick={() => void cover(it)}>
                      <Star size={12} aria-hidden />
                    </button>
                    <button
                      className="icon-btn"
                      title={t('gallery.download')}
                      onClick={() =>
                        download(it.blob, `${it.name}.${it.kind === 'panorama' ? 'jpg' : 'png'}`)
                      }
                    >
                      <Download size={12} aria-hidden />
                    </button>
                    <button
                      className="icon-btn"
                      title={t('gallery.delete')}
                      onClick={async () => {
                        await removeFromGallery(projectId, it.id);
                        void refresh();
                      }}
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </HudDialog>
  );
}

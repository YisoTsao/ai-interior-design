import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteCamera, saveCameraBookmark, updateCamera } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { getCameraThumb, setCameraThumb, shrink } from '../media';
import { useEditor, useEditorStore } from './context';

const NO_CAMS: never[] = [];

/** 視角書籤清單（FE-V3D-09）：縮圖、命名、切換、改名、刪除 */
export function BookmarksMenu() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const camsRaw = useEditor((s) => s.scene.cameras);
  const cams = camsRaw ?? NO_CAMS;
  const [open, setOpen] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void Promise.all(cams.map(async (c) => [c.id, (await getCameraThumb(c.id)) ?? ''] as const)).then((xs) =>
      setThumbs(Object.fromEntries(xs)),
    );
    const off = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  }, [open, cams]);
  const save = async () => {
    const api = viewer3dApi.get();
    const cam = api?.currentCamera();
    if (!api || !cam) return;
    const name = t('top.bookmarkName', { n: cams.length + 1 });
    const c = saveCameraBookmark({ name, ...cam });
    if (!store.getState().exec(c)) return;
    const saved = store.getState().scene.cameras?.at(-1);
    const shot = api.screenshot();
    if (saved && shot) {
      const small = await shrink(shot, 240);
      await setCameraThumb(saved.id, small);
      setThumbs((x) => ({ ...x, [saved.id]: small }));
    }
  };
  return (
    <div ref={ref} className="relative">
      <button
        className="icon-btn"
        aria-label={t('bookmarks.title')}
        title={t('bookmarks.title')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="bookmarks-open"
      >
        <BookMarked size={18} aria-hidden />
      </button>
      {open && (
        <div
          className="hud-popover absolute top-10 left-0 z-20 w-72 space-y-1 p-2"
          data-testid="bookmarks-menu"
        >
          <div className="flex items-center justify-between">
            <span className="hud-title flex-1 text-[11px]">{t('bookmarks.title')}</span>
            <button
              className="btn px-2 py-0.5 text-xs"
              onClick={() => void save()}
              data-testid="bookmark-save"
            >
              <Plus size={12} aria-hidden /> {t('bookmarks.save')}
            </button>
          </div>
          {cams.length === 0 && <p className="text-xs text-muted">{t('bookmarks.empty')}</p>}
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {cams.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  className="flex flex-1 items-center gap-2 p-1 text-left text-xs hover:bg-surface-2"
                  onClick={() => viewer3dApi.get()?.setCamera(c)}
                >
                  {thumbs[c.id] ? (
                    <img src={thumbs[c.id]} alt="" className="h-9 w-14 object-cover" />
                  ) : (
                    <span className="h-9 w-14 bg-border" aria-hidden />
                  )}
                  <span className="truncate">{c.name ?? c.id}</span>
                </button>
                <button
                  className="icon-btn h-6 w-6"
                  aria-label={t('bookmarks.rename')}
                  onClick={() => {
                    const n = window.prompt(t('bookmarks.rename'), c.name ?? '');
                    if (n && n.trim())
                      store.getState().exec(updateCamera(c.id, { name: n.trim().slice(0, 40) }));
                  }}
                >
                  <Pencil size={12} aria-hidden />
                </button>
                <button
                  className="icon-btn h-6 w-6"
                  aria-label={t('bookmarks.delete')}
                  onClick={() => store.getState().exec(deleteCamera(c.id))}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

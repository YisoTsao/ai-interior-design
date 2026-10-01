import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone, X } from 'lucide-react';
import type { CatalogEntry, Material } from '@interiorai/catalog';
import { arObject, arSupport, exportUsdz, startWebXrAr } from '@interiorai/viewer-3d';
import { download } from '../media';

/**
 * AR 預覽（FE-MOB-03）：支援 WebXR 的手機（Android Chrome）直接進入 AR；iOS 以 AR Quick Look 開啟 USDZ；
 * 其他裝置提示改用手機並提供 USDZ 下載。
 */
export function ArButton({
  entry,
  materials,
  materialId,
}: {
  entry: CatalogEntry;
  materials: ReadonlyMap<string, Material>;
  materialId?: string;
}) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const endRef = useRef<() => void>(() => {});
  const run = async () => {
    setMsg(null);
    const obj = await arObject(entry, materials, materialId);
    if (!obj) return setMsg(t('ar.noModel'));
    const sup = await arSupport();
    if (sup === 'webxr') {
      setActive(true);
      await new Promise((r) => requestAnimationFrame(r));
      try {
        endRef.current = await startWebXrAr(obj, overlay.current!, () => setActive(false));
      } catch (e) {
        setActive(false);
        setMsg(t('ar.failed', { message: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    const usdz = await exportUsdz(obj);
    if (sup === 'quicklook') {
      const a = document.createElement('a');
      a.rel = 'ar';
      a.href = URL.createObjectURL(usdz);
      a.appendChild(document.createElement('img'));
      a.click();
      return;
    }
    setMsg(t('ar.unsupported'));
    download(usdz, `${entry.slug}.usdz`);
  };
  return (
    <>
      <button className="btn" onClick={() => void run()} data-testid="asset-ar">
        <Smartphone size={14} aria-hidden /> {t('ar.open')}
      </button>
      {msg && (
        <p className="w-full text-[11px] text-muted" data-testid="ar-msg">
          {msg}
        </p>
      )}
      {createPortal(
        <div
          ref={overlay}
          className={
            active ? 'fixed inset-0 z-[100] flex items-start justify-between p-4 text-white' : 'hidden'
          }
        >
          <span className="rounded bg-black/60 px-3 py-2 text-sm">{t('ar.hint')}</span>
          <button
            className="rounded-full bg-black/60 p-3"
            aria-label={t('ar.close')}
            onClick={() => endRef.current()}
          >
            <X size={20} aria-hidden />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

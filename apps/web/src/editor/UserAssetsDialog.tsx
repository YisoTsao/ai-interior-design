import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, RefreshCw, Trash2 } from 'lucide-react';
import type { CatalogEntry } from '@interiorai/catalog';
import {
  deleteUserAsset,
  inspectModelFile,
  listUserAssets,
  replaceUserAssetFile,
  saveUserAsset,
  UNIT_TO_MM,
  updateUserAsset,
} from '../userAssets';
import { useCatalogVersion } from '../catalogData';
import { HudDialog } from './HudDialog';
import { useThumbnail } from './thumbs';

const CATS: CatalogEntry['category'][] = [
  'living',
  'dining',
  'bedroom',
  'kitchen',
  'bathroom',
  'office',
  'storage',
  'entry',
  'lighting',
  'decor',
];

/**
 * 上傳模型管理（FE-AST-10）：改名、分類、放置方式、尺寸；替換模型檔（保留 id，場景引用不變）；
 * 批次上傳（多選 GLB，以公尺、裝飾、落地為預設）；刪除。
 */
export function UserAssetsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const version = useCatalogVersion();
  const [list, setList] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (open) void listUserAssets().then(setList);
  }, [open, version]);
  const batch = async (files: FileList) => {
    setBusy('batch');
    const errs: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const c = await inspectModelFile(f);
        const k = UNIT_TO_MM.m;
        await saveUserAsset({
          name: f.name.replace(/\.(glb|gltf)$/i, '').slice(0, 40),
          category: 'decor',
          anchor: 'floor',
          dimsMm: { w: c.model.size.x * k, d: c.model.size.z * k, h: c.model.size.y * k },
          bytes: c.bytes,
        });
      } catch (e) {
        errs.push(
          `${f.name}: ${t(`upload.error.${e instanceof Error ? e.message : 'UPLOAD_PARSE'}`, { defaultValue: String(e) })}`,
        );
      }
    }
    setErrors(errs);
    setBusy(null);
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('userAssets.title')}
      testId="user-assets"
      width={820}
    >
      <div className="mb-3 flex items-center gap-2">
        <label className="btn btn-primary cursor-pointer">
          <FileUp size={14} aria-hidden />{' '}
          {busy === 'batch' ? t('userAssets.working') : t('userAssets.batch')}
          <input
            type="file"
            accept=".glb,.gltf"
            multiple
            className="sr-only"
            data-testid="user-assets-batch"
            onChange={(e) => {
              if (e.target.files?.length) void batch(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <p className="text-xs text-muted">{t('userAssets.hint')}</p>
      </div>
      {errors.map((e) => (
        <p key={e} className="text-xs text-danger" role="alert">
          {e}
        </p>
      ))}
      {list.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted">{t('userAssets.empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="user-assets-list">
          {list.map((e) => (
            <Row
              key={`${e.id}-${e.nameZh}-${e.category}-${e.dimsMm.w}`}
              e={e}
              setBusy={setBusy}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </HudDialog>
  );
}

function Row({
  e,
  busy,
  setBusy,
}: {
  e: CatalogEntry;
  busy: string | null;
  setBusy: (v: string | null) => void;
}) {
  const { t } = useTranslation();
  const thumb = useThumbnail(e);
  const [d, setD] = useState(e.dimsMm);
  const num = (k: 'w' | 'd' | 'h') => (
    <input
      className="field w-20 text-right"
      type="number"
      min={1}
      value={d[k]}
      aria-label={t(`userAssets.dim.${k}`)}
      onChange={(ev) => setD({ ...d, [k]: Math.max(1, Math.round(Number(ev.target.value) || 1)) })}
      onBlur={() => d[k] !== e.dimsMm[k] && void updateUserAsset(e.id, { dimsMm: d })}
    />
  );
  return (
    <li className="hud-section flex flex-wrap items-center gap-2 p-2 text-xs" data-testid="user-asset-row">
      <span className="inv-thumb h-12 w-12 shrink-0">{thumb && <img src={thumb} alt="" />}</span>
      <input
        className="field w-40"
        defaultValue={e.nameZh}
        aria-label={t('userAssets.name')}
        onBlur={(ev) =>
          ev.target.value.trim() &&
          ev.target.value !== e.nameZh &&
          void updateUserAsset(e.id, { nameZh: ev.target.value.trim() })
        }
        data-testid="user-asset-name"
      />
      <select
        className="field w-28"
        value={e.category}
        aria-label={t('userAssets.category')}
        onChange={(ev) =>
          void updateUserAsset(e.id, { category: ev.target.value as CatalogEntry['category'] })
        }
      >
        {CATS.map((c) => (
          <option key={c} value={c}>
            {t(`assets.categories.${c}`)}
          </option>
        ))}
      </select>
      <select
        className="field w-24"
        value={e.anchor}
        aria-label={t('userAssets.anchor')}
        onChange={(ev) => void updateUserAsset(e.id, { anchor: ev.target.value as CatalogEntry['anchor'] })}
      >
        {(['floor', 'wall', 'ceiling'] as const).map((a) => (
          <option key={a} value={a}>
            {t(`upload.anchors.${a}`)}
          </option>
        ))}
      </select>
      <span className="flex items-center gap-1">
        {num('w')}×{num('d')}×{num('h')}
        {' mm'}
      </span>
      <span className="ml-auto flex gap-1">
        <label className="icon-btn cursor-pointer" title={t('userAssets.replace')}>
          <RefreshCw size={14} aria-hidden className={busy === e.id ? 'animate-spin' : ''} />
          <input
            type="file"
            accept=".glb,.gltf"
            className="sr-only"
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (!f) return;
              setBusy(e.id);
              try {
                const c = await inspectModelFile(f);
                await replaceUserAssetFile(e.id, c.bytes);
              } finally {
                setBusy(null);
              }
            }}
          />
        </label>
        <button
          className="icon-btn"
          title={t('upload.delete', { name: e.nameZh })}
          onClick={() => {
            if (window.confirm(t('upload.deleteConfirm', { name: e.nameZh }))) void deleteUserAsset(e.id);
          }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </span>
    </li>
  );
}

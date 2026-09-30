import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Upload, X } from 'lucide-react';
import type { CatalogEntry } from '@interiorai/catalog';
import { renderThumbnail } from '@interiorai/viewer-3d';
import {
  UNIT_TO_MM,
  UPLOAD_LIMITS,
  inspectModelFile,
  saveUserAsset,
  type UploadCheck,
  type UploadUnit,
} from '../userAssets';
import { NumberField, SelectField } from './fields';

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
 * 上傳 3D 模型（GLB／自含式 glTF）：讀檔 → 解析與檢查（格式、大小、面數、尺寸）→ 預覽縮圖 →
 * 選擇檔案單位（glTF 標準為公尺）與分類、放置方式 → 聲明使用權 → 存入本機資產庫。
 */
export function UploadModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<UploadCheck | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<UploadUnit>('m');
  const [category, setCategory] = useState<CatalogEntry['category']>('decor');
  const [anchor, setAnchor] = useState<CatalogEntry['anchor']>('floor');
  const [elevation, setElevation] = useState(1200);
  const [dims, setDims] = useState({ w: 0, d: 0, h: 0 });
  const [licensed, setLicensed] = useState(false);

  useEffect(() => {
    if (open) return;
    setCheck(null);
    setPreview(null);
    setError(null);
    setName('');
    setLicensed(false);
  }, [open]);
  useEffect(() => {
    if (!check) return;
    const k = UNIT_TO_MM[unit];
    setDims({
      w: Math.round(check.model.size.x * k),
      d: Math.round(check.model.size.z * k),
      h: Math.round(check.model.size.y * k),
    });
  }, [check, unit]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const c = await inspectModelFile(f);
      setCheck(c);
      setName(f.name.replace(/\.(glb|gltf)$/i, '').slice(0, 40));
      setPreview(renderThumbnail(c.model.root.clone(true)));
    } catch (e) {
      setCheck(null);
      setError(e instanceof Error ? e.message : 'UPLOAD_PARSE');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!check) return;
    setBusy(true);
    try {
      await saveUserAsset({
        name: name.trim() || t('upload.untitled'),
        category,
        anchor,
        dimsMm: dims,
        elevationMm: anchor === 'wall' ? elevation : undefined,
        bytes: check.bytes,
      });
      onOpenChange(false);
    } catch {
      setError('UPLOAD_SAVE');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="game-ui hud-panel fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto p-5"
          data-testid="upload-dialog"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="hud-title flex-1 text-base">{t('upload.title')}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={t('upload.close')}>
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-xs text-muted">
            {t('upload.desc', { mb: UPLOAD_LIMITS.maxBytes / 1024 / 1024 })}
          </Dialog.Description>
          <label className="flex cursor-pointer flex-col items-center gap-2 border border-dashed border-border p-5 text-center text-sm hover:border-primary">
            <Upload size={22} aria-hidden className="text-primary" />
            <span>{busy ? t('upload.reading') : t('upload.pick')}</span>
            <input
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              className="sr-only"
              data-testid="upload-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {error && (
            <p role="alert" className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={12} aria-hidden />{' '}
              {t(`upload.error.${error}`, { defaultValue: t('upload.error.UPLOAD_PARSE') })}
            </p>
          )}
          {check && (
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="grid place-items-center bg-black/30 p-2">
                {preview && (
                  <img src={preview} alt={t('upload.preview')} className="h-36 w-36 object-contain" />
                )}
                <p className="mt-1 font-mono text-[10px] text-muted">
                  {t('upload.stats', {
                    tris: check.model.triangles.toLocaleString(),
                    meshes: check.model.meshes,
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="grid gap-1 text-xs">
                  <span>{t('upload.name')}</span>
                  <input
                    className="field"
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="upload-name"
                  />
                </label>
                <SelectField
                  label={t('upload.unit')}
                  value={unit}
                  onChange={setUnit}
                  options={(['m', 'cm', 'mm', 'in'] as const).map((u) => ({
                    value: u,
                    label: t(`upload.units.${u}`),
                  }))}
                />
                <NumberField
                  label={t('param.width')}
                  value={dims.w}
                  suffix="mm"
                  onCommit={(w) => setDims({ ...dims, w })}
                />
                <NumberField
                  label={t('param.depth')}
                  value={dims.d}
                  suffix="mm"
                  onCommit={(d) => setDims({ ...dims, d })}
                />
                <NumberField
                  label={t('param.height')}
                  value={dims.h}
                  suffix="mm"
                  onCommit={(h) => setDims({ ...dims, h })}
                />
                <SelectField
                  label={t('upload.category')}
                  value={category}
                  onChange={setCategory}
                  options={CATS.map((c) => ({ value: c, label: t(`assets.categories.${c}`) }))}
                />
                <SelectField
                  label={t('upload.anchor')}
                  value={anchor}
                  onChange={setAnchor}
                  options={(['floor', 'wall', 'ceiling'] as const).map((a) => ({
                    value: a,
                    label: t(`upload.anchors.${a}`),
                  }))}
                />
                {anchor === 'wall' && (
                  <NumberField
                    label={t('upload.elevation')}
                    value={elevation}
                    suffix="mm"
                    onCommit={setElevation}
                  />
                )}
              </div>
            </div>
          )}
          {check?.warnings.map((w) => (
            <p key={w} className="flex items-center gap-1 text-xs text-warn">
              <AlertTriangle size={12} aria-hidden />{' '}
              {t(`upload.warn.${w}`, { max: UPLOAD_LIMITS.maxTriangles.toLocaleString() })}
            </p>
          ))}
          {check && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={licensed}
                onChange={(e) => setLicensed(e.target.checked)}
                data-testid="upload-license"
              />
              <span>{t('upload.license')}</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close className="btn">{t('upload.cancel')}</Dialog.Close>
            <button
              className="btn btn-primary"
              disabled={!check || !licensed || busy || dims.w <= 0 || dims.d <= 0 || dims.h <= 0}
              onClick={() => void save()}
              data-testid="upload-save"
            >
              {t('upload.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

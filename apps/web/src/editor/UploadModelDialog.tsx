import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Upload, X } from 'lucide-react';
import type { CatalogEntry } from '@interiorai/catalog';
import { renderThumbnail } from '@interiorai/viewer-3d';
import { MODEL_ACCEPT } from '@interiorai/viewer-3d';
import {
  UNIT_TO_MM,
  UPLOAD_LIMITS,
  convertUpload,
  inspectModelFiles,
  modelBaseName,
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
 * 上傳 3D 模型（FE-AST-11）：選檔或拖放（可多檔：.obj＋.mtl＋貼圖、.gltf＋.bin，或 zip）→
 * 瀏覽器轉成 GLB（GLB／glTF／OBJ／FBX／DAE／STL／PLY／3DS／3MF／USDZ／VRML）→ 檢查（面數、尺寸、缺檔）→
 * 預覽縮圖 → 單位（自動推測）、轉正、減面、分類、放置方式 → 聲明使用權 → 存入本機資產庫。
 * initialFiles：從編輯器畫布拖放模型檔時直接帶入。
 */
export function UploadModelDialog({
  open,
  onOpenChange,
  initialFiles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialFiles?: File[] | null;
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
  const [over, setOver] = useState(false);

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

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setBusy(true);
    try {
      const c = await inspectModelFiles(files);
      setCheck(c);
      setUnit(c.suggestedUnit);
      setName(modelBaseName(c.source.mainName));
      setPreview(renderThumbnail(c.model.root.clone(true)));
    } catch (e) {
      setCheck(null);
      setError(e instanceof Error ? e.message : 'UPLOAD_PARSE');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && initialFiles?.length) void onFiles(initialFiles);
  }, [open, initialFiles]);

  /** 轉正／減面：從已解析的原始模型重新轉換 */
  const reconvert = async (opts: { zUp: boolean; simplify: boolean }) => {
    if (!check) return;
    setBusy(true);
    try {
      const c = await convertUpload(check.source, opts);
      setCheck(c);
      setPreview(renderThumbnail(c.model.root.clone(true)));
    } catch (e) {
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
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 border border-dashed p-5 text-center text-sm hover:border-primary ${over ? 'border-primary bg-primary/10' : 'border-border'}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void onFiles(Array.from(e.dataTransfer.files));
            }}
            data-testid="upload-drop"
          >
            <Upload size={22} aria-hidden className="text-primary" />
            <span>{busy ? t('upload.reading') : t('upload.pick')}</span>
            <span className="text-[11px] text-muted">{t('upload.formats')}</span>
            <input
              type="file"
              multiple
              accept={MODEL_ACCEPT}
              className="sr-only"
              data-testid="upload-file"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void onFiles(files);
              }}
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
                <p className="font-mono text-[10px] text-primary" data-testid="upload-format">
                  {t('upload.converted', { format: check.format.toUpperCase() })}
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
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={check.zUp}
                    disabled={busy}
                    onChange={(e) => void reconvert({ zUp: e.target.checked, simplify: check.simplified })}
                    data-testid="upload-zup"
                  />
                  {t('upload.zUp')}
                </label>
                {(check.simplified || check.source.triangles > UPLOAD_LIMITS.maxTriangles) && (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={check.simplified}
                      disabled={busy}
                      onChange={(e) => void reconvert({ zUp: check.zUp, simplify: e.target.checked })}
                      data-testid="upload-simplify"
                    />
                    {t('upload.simplify', { max: UPLOAD_LIMITS.maxTriangles.toLocaleString() })}
                  </label>
                )}
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
              {t(`upload.warn.${w}`, {
                max: UPLOAD_LIMITS.maxTriangles.toLocaleString(),
                files: check.missing.join(', '),
              })}
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

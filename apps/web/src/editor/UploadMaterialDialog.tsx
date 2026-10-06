import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import type { Material } from '@interiorai/catalog';
import { saveUserMaterial } from '../userMaterials';
import { HudDialog } from './HudDialog';

const CATS: Material['category'][] = ['floor', 'wall', 'wood', 'stone', 'fabric', 'metal', 'ceiling'];

/** 自訂材質（FE-FIN-06）：上傳貼圖＋名稱、分類、真實尺寸（一個重複單元）、粗糙度、金屬度、單價 */
export function UploadMaterialDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cat, setCat] = useState<Material['category']>('floor');
  const [w, setW] = useState(600);
  const [h, setH] = useState(600);
  const [rough, setRough] = useState(0.7);
  const [metal, setMetal] = useState(0);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    if (!open) {
      setFile(null);
      setName('');
    }
  }, [open]);
  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await saveUserMaterial({
        file,
        name: name.trim() || file.name.replace(/\.[a-z0-9]+$/i, ''),
        category: cat,
        realSizeMm: { w, h },
        roughness: rough,
        metalness: metal,
        ...(Number(price) > 0 ? { pricePerM2Twd: Number(price) } : {}),
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  const num = (label: string, v: number, set: (n: number) => void, testId?: string) => (
    <label className="text-xs">
      <span className="mb-1 block text-muted">{label}</span>
      <input
        className="field w-full"
        type="number"
        min={1}
        value={v}
        onChange={(e) => set(Math.max(1, Number(e.target.value) || 1))}
        data-testid={testId}
      />
    </label>
  );
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('userMaterial.title')}
      testId="upload-material"
      width={560}
      footer={
        <>
          <button className="btn" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!file || busy}
            onClick={() => void save()}
            data-testid="material-save"
          >
            {t('userMaterial.save')}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-[160px_1fr]">
        <label className="grid aspect-square cursor-pointer place-items-center rounded border border-dashed border-border bg-bg text-xs text-muted">
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <Upload size={18} aria-hidden />
              {t('userMaterial.pick')}
            </span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            data-testid="material-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="mb-1 block text-muted">{t('userMaterial.name')}</span>
            <input
              className="field w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="material-name"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted">{t('userMaterial.category')}</span>
            <select
              className="field w-full"
              value={cat}
              onChange={(e) => setCat(e.target.value as Material['category'])}
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {t(`paint.categories.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {num(t('userMaterial.width'), w, setW, 'material-w')}
            {num(t('userMaterial.height'), h, setH)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>
              <span className="mb-1 block text-muted">{`${t('userMaterial.roughness')} ${rough.toFixed(2)}`}</span>
              <input
                className="hud-range w-full"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={rough}
                onChange={(e) => setRough(Number(e.target.value))}
              />
            </label>
            <label>
              <span className="mb-1 block text-muted">{`${t('userMaterial.metalness')} ${metal.toFixed(2)}`}</span>
              <input
                className="hud-range w-full"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={metal}
                onChange={(e) => setMetal(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block text-muted">{t('userMaterial.price')}</span>
            <input
              className="field w-full"
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-muted">{t('userMaterial.hint')}</p>
        </div>
      </div>
    </HudDialog>
  );
}

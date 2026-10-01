import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

/** 構圖裁切比例（FE-V3D-10）；free＝跟視埠一樣 */
export const CROPS = ['free', '16:9', '3:2', '4:3', '1:1', '4:5', '9:16'] as const;
export type Crop = (typeof CROPS)[number];
export const cropRatio = (c: Crop): number | null => {
  if (c === 'free') return null;
  const [a, b] = c.split(':').map(Number) as [number, number];
  return a / b;
};
/** 長邊 long 依比例換成出圖尺寸（free＝沿用 fallback） */
export function cropSize(c: Crop, long: number, fallback: [number, number]): [number, number] {
  const r = cropRatio(c);
  if (!r) return fallback;
  return r >= 1 ? [long, Math.round(long / r)] : [Math.round(long * r), long];
}

interface CameraFx {
  dof: boolean;
  fStop: number;
  crop: Crop;
  set(p: Partial<Omit<CameraFx, 'set'>>): void;
}
const KEY = 'cameraFx';
const load = (): Pick<CameraFx, 'dof' | 'fStop' | 'crop'> => {
  try {
    return {
      dof: false,
      fStop: 4,
      crop: 'free',
      ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as object),
    };
  } catch {
    return { dof: false, fStop: 4, crop: 'free' };
  }
};
/** 相機效果（景深、裁切比例）：本機偏好，不入 Scene */
export const useCameraFx = create<CameraFx>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    const { dof, fStop, crop } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ dof, fStop, crop }));
    } catch {
      /* 私密模式 */
    }
  },
}));

/** HUD：景深（f 值）與構圖比例 */
export function CameraControl() {
  const { t } = useTranslation();
  const fx = useCameraFx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <span className="relative" ref={box}>
      <button
        className="hud-chip"
        aria-expanded={open}
        aria-pressed={fx.dof || fx.crop !== 'free'}
        onClick={() => setOpen(!open)}
        data-testid="camera-fx"
      >
        {t('camera.title')}
      </button>
      {open && (
        <div
          className="hud-panel absolute top-9 left-0 z-30 w-56 space-y-2 p-3 text-xs"
          role="dialog"
          aria-label={t('camera.title')}
        >
          <label className="flex items-center justify-between gap-2">
            <span>{t('camera.dof')}</span>
            <input
              type="checkbox"
              checked={fx.dof}
              onChange={(e) => fx.set({ dof: e.target.checked })}
              data-testid="camera-dof"
            />
          </label>
          <label className="grid gap-1">
            <span>{t('camera.fStop', { f: fx.fStop })}</span>
            <input
              className="hud-range"
              type="range"
              min={1.4}
              max={16}
              step={0.1}
              value={fx.fStop}
              disabled={!fx.dof}
              onChange={(e) => fx.set({ fStop: Number(e.target.value) })}
              data-testid="camera-fstop"
            />
          </label>
          <p className="text-[11px] text-muted">{t('camera.dofHint')}</p>
          <label className="grid gap-1">
            <span>{t('camera.crop')}</span>
            <select
              className="field font-sans"
              value={fx.crop}
              onChange={(e) => fx.set({ crop: e.target.value as Crop })}
              data-testid="camera-crop"
            >
              {CROPS.map((c) => (
                <option key={c} value={c}>
                  {c === 'free' ? t('camera.cropFree') : c}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </span>
  );
}

/** 視埠上的構圖框：框外變暗，框線＋三分線（出圖範圍） */
export function CropFrame({ width, height }: { width: number; height: number }) {
  const crop = useCameraFx((s) => s.crop);
  const r = cropRatio(crop);
  if (!r || !width || !height) return null;
  const [w, h] = width / height > r ? [height * r, height] : [width, width / r];
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-testid="crop-frame" data-crop={crop}>
      <svg width={width} height={height} className="absolute inset-0">
        <path
          d={`M0 0H${width}V${height}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`}
          fill="rgba(0,0,0,0.45)"
          fillRule="evenodd"
        />
        <rect x={x} y={y} width={w} height={h} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
        {[1, 2].map((i) => (
          <g key={i} stroke="rgba(255,255,255,0.25)" strokeWidth={1}>
            <line x1={x + (w * i) / 3} y1={y} x2={x + (w * i) / 3} y2={y + h} />
            <line x1={x} y1={y + (h * i) / 3} x2={x + w} y2={y + (h * i) / 3} />
          </g>
        ))}
      </svg>
    </div>
  );
}

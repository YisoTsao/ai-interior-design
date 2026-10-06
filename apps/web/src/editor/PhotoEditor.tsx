import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Type } from 'lucide-react';
import { cropRect, cssFilter, DEFAULT_EDIT, renderEdit, tempTint, type PhotoEdit } from './photoEdit';

/** 效果圖後製（FE-RND-05）：左側預覽（點圖加標籤）、右側參數；「另存」產生新圖加入圖庫 */
export function PhotoEditor({
  src,
  blob,
  onSave,
}: {
  src: string;
  blob: Blob;
  onSave: (b: Blob) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [e, setE] = useState<PhotoEdit>(DEFAULT_EDIT);
  const [labelMode, setLabelMode] = useState(false);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<PhotoEdit>) => setE((x) => ({ ...x, ...p }));
  const tint = tempTint(e.temperature);
  // 以 CSS 近似裁切：外框依比例、影像 object-fit: cover
  const box = size ? cropRect(size[0], size[1], e.crop) : null;
  const slider = (
    key: 'exposure' | 'temperature' | 'saturation' | 'contrast',
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="block text-xs">
      <span className="flex justify-between">
        <span>{t(`photo.${key}`)}</span>
        <span className="font-mono">{e[key]}</span>
      </span>
      <input
        className="hud-range w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={e[key]}
        onChange={(ev) => set({ [key]: Number(ev.target.value) })}
        data-testid={`photo-${key}`}
      />
    </label>
  );
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded bg-black/40">
        <div
          className="relative max-h-full max-w-full overflow-hidden"
          style={box ? { aspectRatio: `${box[2]} / ${box[3]}`, height: '100%' } : { height: '100%' }}
          onClick={(ev) => {
            if (!labelMode) return;
            const r = ev.currentTarget.getBoundingClientRect();
            const text = window.prompt(t('photo.labelPrompt'));
            if (text)
              set({
                labels: [
                  ...e.labels,
                  { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, text },
                ],
              });
            setLabelMode(false);
          }}
          data-testid="photo-canvas"
        >
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: cssFilter(e) }}
            onLoad={(ev) => setSize([ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight])}
          />
          {tint && (
            <div
              className="pointer-events-none absolute inset-0 mix-blend-multiply"
              style={{ background: tint }}
            />
          )}
          {e.labels.map((l, i) => (
            <span
              key={i}
              className="absolute rounded bg-black/65 px-1.5 text-xs text-white"
              style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, transform: 'translateY(-70%)' }}
            >
              {l.text}
            </span>
          ))}
          {e.watermark && (
            <span className="absolute right-2 bottom-2 text-sm font-bold text-white/70">{e.watermark}</span>
          )}
        </div>
      </div>
      <div className="w-56 shrink-0 space-y-2 overflow-y-auto">
        {slider('exposure', -2, 2, 0.1)}
        {slider('temperature', -100, 100, 5)}
        {slider('saturation', 0, 2, 0.05)}
        {slider('contrast', 0.5, 1.5, 0.05)}
        <label className="block text-xs">
          <span className="mb-1 block">{t('photo.crop')}</span>
          <select
            className="field w-full"
            value={e.crop}
            onChange={(ev) => set({ crop: ev.target.value as PhotoEdit['crop'] })}
            data-testid="photo-crop"
          >
            {(['original', '16:9', '4:3', '1:1', '9:16'] as const).map((c) => (
              <option key={c} value={c}>
                {c === 'original' ? t('photo.original') : c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block">{t('photo.watermark')}</span>
          <input
            className="field w-full"
            value={e.watermark}
            onChange={(ev) => set({ watermark: ev.target.value })}
            placeholder="InteriorAI"
            data-testid="photo-watermark"
          />
        </label>
        <button
          className="btn w-full justify-center"
          aria-pressed={labelMode}
          onClick={() => setLabelMode(!labelMode)}
        >
          <Type size={14} aria-hidden /> {labelMode ? t('photo.labelClick') : t('photo.addLabel')}
        </button>
        {e.labels.length > 0 && (
          <button className="btn w-full justify-center" onClick={() => set({ labels: [] })}>
            {t('photo.clearLabels')}
          </button>
        )}
        <button className="btn w-full justify-center" onClick={() => setE(DEFAULT_EDIT)}>
          {t('photo.reset')}
        </button>
        <button
          className="btn btn-primary w-full justify-center"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(await renderEdit(blob, e));
            } finally {
              setBusy(false);
            }
          }}
          data-testid="photo-save"
        >
          <Save size={14} aria-hidden /> {t('photo.saveNew')}
        </button>
      </div>
    </div>
  );
}

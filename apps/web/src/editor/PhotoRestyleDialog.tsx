import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brush, ImagePlus, Save, Sparkles, Trash2 } from 'lucide-react';
import {
  localPreviewProvider,
  PHOTO_STYLES,
  type PhotoStyle,
  type PhotoStyleProvider,
} from '../ai/photoStyle';
import { addToGallery } from '../media';
import { useEditor } from './context';
import { HudDialog } from './HudDialog';

/** 照片長邊上限（記憶體與速度） */
const MAX_SIDE = 1600;

/**
 * 照片換風格（FE-AI-01）：上傳現況照片 → 選風格／提示詞 → 多張結果 → 前後比較 →
 * 畫遮罩局部重繪 → 存入圖庫。供應商預設為本機預覽（非 AI），介面明確標示。
 */
export function PhotoRestyleDialog({
  open,
  onOpenChange,
  provider = localPreviewProvider,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider?: PhotoStyleProvider;
}) {
  const { t } = useTranslation();
  const projectId = useEditor((s) => s.projectId);
  const [photo, setPhoto] = useState<{ bmp: ImageBitmap; url: string; name: string } | null>(null);
  const [style, setStyle] = useState<PhotoStyle>('japandi');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(3);
  const [results, setResults] = useState<{ url: string; blob: Blob }[]>([]);
  const [active, setActive] = useState(0);
  const [split, setSplit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [brush, setBrush] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open) return;
    results.forEach((r) => URL.revokeObjectURL(r.url));
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setResults([]);
    setBrush(false);
    setSaved(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const src = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
    const bmp =
      k < 1
        ? await createImageBitmap(src, {
            resizeWidth: Math.round(src.width * k),
            resizeHeight: Math.round(src.height * k),
          })
        : src;
    if (bmp !== src) src.close();
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const url = URL.createObjectURL(
      await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.92)),
    );
    setPhoto({ bmp, url, name: f.name.replace(/\.[a-z0-9]+$/i, '') });
    setResults([]);
  };

  /** 遮罩畫布 → 0–255 陣列（沒有塗任何地方＝null） */
  const readMask = (): Uint8Array | null => {
    const c = maskRef.current;
    if (!c || !photo) return null;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const m = new Uint8Array(c.width * c.height);
    let any = false;
    for (let i = 0; i < m.length; i++) {
      m[i] = d[i * 4 + 3]!;
      any ||= m[i]! > 0;
    }
    return any ? m : null;
  };

  const generate = async (opts: { inpaint?: boolean } = {}) => {
    if (!photo) return;
    setBusy(true);
    setSaved(null);
    try {
      if (opts.inpaint) {
        // 局部重繪：以目前選取的結果為底，只改遮罩內
        const base = results[active];
        const mask = readMask();
        if (!base || !mask) return;
        const bmp = await createImageBitmap(base.blob);
        const blob = await provider.generate(bmp, { style, prompt, variant: results.length }, mask);
        bmp.close();
        const r = { blob, url: URL.createObjectURL(blob) };
        setResults((x) => [...x, r]);
        setActive(results.length);
        maskRef.current?.getContext('2d')?.clearRect(0, 0, photo.bmp.width, photo.bmp.height);
        return;
      }
      results.forEach((r) => URL.revokeObjectURL(r.url));
      const out: { url: string; blob: Blob }[] = [];
      for (let v = 0; v < count; v++) {
        const blob = await provider.generate(photo.bmp, { style, prompt, variant: v });
        out.push({ blob, url: URL.createObjectURL(blob) });
      }
      setResults(out);
      setActive(0);
    } finally {
      setBusy(false);
    }
  };

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!brush || e.buttons !== 1) return;
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255, 64, 160, 1)';
    g.beginPath();
    g.arc(x, y, Math.max(c.width, c.height) / 40, 0, Math.PI * 2);
    g.fill();
  };

  const cur = results[active];
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('photoStyle.title')}
      testId="photo-restyle"
      width={980}
    >
      {!provider.generative && (
        <p className="text-[11px] text-warn" data-testid="photo-preview-note">
          {t('photoStyle.previewNote')}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          {!photo ? (
            <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-border text-sm text-muted hover:border-primary">
              <ImagePlus size={26} aria-hidden className="text-primary" />
              {t('photoStyle.pick')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
                data-testid="photo-file"
              />
            </label>
          ) : (
            <div className="relative select-none" data-testid="photo-stage">
              <img
                src={photo.url}
                alt={t('photoStyle.original')}
                className="block w-full"
                draggable={false}
              />
              {cur && (
                <img
                  src={cur.url}
                  alt={t('photoStyle.result')}
                  className="absolute inset-0 block h-full w-full"
                  style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                  draggable={false}
                  data-testid="photo-result"
                />
              )}
              <canvas
                ref={maskRef}
                width={photo.bmp.width}
                height={photo.bmp.height}
                className={`absolute inset-0 h-full w-full opacity-45 ${brush ? 'cursor-crosshair' : 'pointer-events-none'}`}
                onPointerDown={paint}
                onPointerMove={paint}
                data-testid="photo-mask"
              />
              {cur && !brush && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={split}
                  onChange={(e) => setSplit(Number(e.target.value))}
                  className="hud-range absolute right-2 bottom-2 left-2"
                  aria-label={t('photoStyle.compare')}
                  data-testid="photo-compare"
                />
              )}
            </div>
          )}
          {results.length > 0 && (
            <div className="flex gap-2 overflow-x-auto" data-testid="photo-results">
              {results.map((r, i) => (
                <button
                  key={r.url}
                  className="inv-slot h-16 w-24 shrink-0 p-0.5"
                  aria-pressed={i === active}
                  onClick={() => setActive(i)}
                  aria-label={t('photoStyle.pickResult', { n: i + 1 })}
                >
                  <img src={r.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t('photoStyle.style')}>
            {PHOTO_STYLES.map((s) => (
              <button
                key={s}
                className="hud-chip justify-center"
                aria-pressed={style === s}
                onClick={() => setStyle(s)}
                data-testid={`photo-style-${s}`}
              >
                {t(`assets.styles.${s}`, { defaultValue: t(`photoStyle.styles.${s}`) })}
              </button>
            ))}
          </div>
          <label className="grid gap-1">
            <span>{t('photoStyle.prompt')}</span>
            <textarea
              className="field font-sans"
              rows={3}
              value={prompt}
              placeholder={t('photoStyle.promptPh')}
              onChange={(e) => setPrompt(e.target.value)}
              data-testid="photo-prompt"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>{t('photoStyle.count')}</span>
            <select
              className="field w-20"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              data-testid="photo-count"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary w-full justify-center"
            disabled={!photo || busy}
            onClick={() => void generate()}
            data-testid="photo-generate"
          >
            <Sparkles size={14} aria-hidden /> {busy ? t('photoStyle.working') : t('photoStyle.generate')}
          </button>
          <hr className="border-border" />
          <p className="text-muted">{t('photoStyle.inpaintHint')}</p>
          <div className="flex gap-1">
            <button
              className="btn flex-1 justify-center"
              aria-pressed={brush}
              disabled={!cur}
              onClick={() => setBrush(!brush)}
              data-testid="photo-brush"
            >
              <Brush size={14} aria-hidden /> {t('photoStyle.brush')}
            </button>
            <button
              className="icon-btn"
              aria-label={t('photoStyle.clearMask')}
              title={t('photoStyle.clearMask')}
              disabled={!photo}
              onClick={() => maskRef.current?.getContext('2d')?.clearRect(0, 0, 1e5, 1e5)}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
          <button
            className="btn w-full justify-center"
            disabled={!cur || busy}
            onClick={() => void generate({ inpaint: true })}
            data-testid="photo-inpaint"
          >
            {t('photoStyle.inpaint')}
          </button>
          <button
            className="btn w-full justify-center"
            disabled={!cur || !photo}
            onClick={async () => {
              if (!cur || !photo) return;
              await addToGallery(projectId, {
                kind: 'render',
                name: `${photo.name}-${style}-${active + 1}`,
                blob: cur.blob,
                width: photo.bmp.width,
                height: photo.bmp.height,
              });
              setSaved(t('photoStyle.saved'));
            }}
            data-testid="photo-save"
          >
            <Save size={14} aria-hidden /> {t('photoStyle.save')}
          </button>
          {saved && <p className="text-accent">{saved}</p>}
        </div>
      </div>
    </HudDialog>
  );
}

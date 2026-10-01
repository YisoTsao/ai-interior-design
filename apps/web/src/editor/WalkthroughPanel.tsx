import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Circle, Play, Square } from 'lucide-react';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { download } from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';
import { cameraAt, pathDuration, pickVideoType, type CamKey } from './walkthrough';

/**
 * 漫遊影片（FE-RND-06）：勾選並排序相機書籤為關鍵幀 → 預覽（3D 相機沿路徑移動）→ 錄成 MP4（瀏覽器支援時）或 WebM。
 * 錄影直接擷取 3D 畫布（含後處理），不經伺服器。
 */
export function WalkthroughPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const projectName = useEditor((s) => s.projectName);
  const camsRaw = useEditor((s) => s.scene.cameras);
  const cams = camsRaw ?? [];
  const [order, setOrder] = useState<string[]>([]);
  const [seg, setSeg] = useState(3);
  const [state, setState] = useState<'idle' | 'preview' | 'record'>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ url: string; ext: string; blob: Blob } | null>(null);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (open) {
      setOrder((o) => (o.length ? o.filter((id) => cams.some((c) => c.id === id)) : cams.map((c) => c.id)));
      if (store.getState().view !== '3d') store.getState().setView('3d');
    } else stopRef.current();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys: CamKey[] = order
    .map((id) => cams.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ position: c.position, target: c.target, fovDeg: c.fovDeg }));
  const total = pathDuration(keys, seg);
  const videoType =
    typeof MediaRecorder !== 'undefined' ? pickVideoType((m) => MediaRecorder.isTypeSupported(m)) : null;

  /** 沿路徑播放；onFrame 每幀回呼；回傳 Promise 於結束時 resolve */
  const run = (onDone: () => void) => {
    const t0 = performance.now();
    let raf = 0;
    let alive = true;
    const step = () => {
      if (!alive) return;
      const sec = (performance.now() - t0) / 1000;
      const c = cameraAt(keys, seg, sec);
      if (c) viewer3dApi.get()?.setCamera(c);
      setProgress(Math.min(1, sec / Math.max(0.001, total)));
      if (sec >= total) {
        alive = false;
        onDone();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  };
  const preview = () => {
    setState('preview');
    const cancel = run(() => setState('idle'));
    stopRef.current = () => {
      cancel();
      setState('idle');
    };
  };
  const record = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=viewer3d] canvas');
    if (!canvas || !videoType) return;
    const first = cameraAt(keys, seg, 0);
    if (first) viewer3dApi.get()?.setCamera(first);
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: videoType.mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: videoType.mime });
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), ext: videoType.ext, blob });
      setState('idle');
    };
    setState('record');
    rec.start(250);
    const cancel = run(() => rec.state !== 'inactive' && rec.stop());
    stopRef.current = () => {
      cancel();
      if (rec.state !== 'inactive') rec.stop();
    };
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('walk.title')}
      side="right"
      width={340}
      testId="walkthrough"
    >
      {cams.length < 2 ? (
        <p className="text-xs text-muted">{t('walk.needBookmarks')}</p>
      ) : (
        <div className="space-y-3 text-xs">
          <ol className="space-y-1" data-testid="walk-keys">
            {cams.map((c) => {
              const i = order.indexOf(c.id);
              return (
                <li key={c.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={i >= 0}
                    onChange={(e) =>
                      setOrder(e.target.checked ? [...order, c.id] : order.filter((x) => x !== c.id))
                    }
                    aria-label={c.name ?? c.id}
                  />
                  <span className="w-5 text-center font-mono text-accent">{i >= 0 ? i + 1 : ''}</span>
                  <span className="flex-1 truncate">{c.name ?? c.id}</span>
                  {i >= 0 && (
                    <>
                      <button
                        className="icon-btn h-6 w-6"
                        aria-label={t('walk.up')}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={12} aria-hidden />
                      </button>
                      <button
                        className="icon-btn h-6 w-6"
                        aria-label={t('walk.down')}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={12} aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          <label className="flex items-center justify-between gap-2">
            <span>{t('walk.segment')}</span>
            <input
              type="number"
              className="field w-20"
              min={0.5}
              max={20}
              step={0.5}
              value={seg}
              onChange={(e) => setSeg(Math.max(0.5, Math.min(20, Number(e.target.value) || 3)))}
              data-testid="walk-seg"
            />
          </label>
          <p className="text-muted">{t('walk.total', { s: total.toFixed(1), n: keys.length })}</p>
          <div className="h-1.5 w-full bg-black/30">
            <div
              className="h-full bg-primary"
              style={{ width: `${progress * 100}%` }}
              data-testid="walk-progress"
            />
          </div>
          <div className="flex gap-2">
            {state === 'idle' ? (
              <>
                <button
                  className="btn flex-1 justify-center"
                  disabled={keys.length < 2}
                  onClick={preview}
                  data-testid="walk-preview"
                >
                  <Play size={14} aria-hidden /> {t('walk.preview')}
                </button>
                <button
                  className="btn btn-primary flex-1 justify-center"
                  disabled={keys.length < 2 || !videoType}
                  onClick={record}
                  data-testid="walk-record"
                >
                  <Circle size={14} aria-hidden />{' '}
                  {t('walk.record', { ext: videoType?.ext.toUpperCase() ?? '—' })}
                </button>
              </>
            ) : (
              <button
                className="btn flex-1 justify-center"
                onClick={() => stopRef.current()}
                data-testid="walk-stop"
              >
                <Square size={14} aria-hidden /> {t(state === 'record' ? 'walk.recording' : 'walk.stop')}
              </button>
            )}
          </div>
          {!videoType && <p className="text-warn">{t('walk.noRecorder')}</p>}
          {result && (
            <div className="space-y-2" data-testid="walk-result">
              <video src={result.url} controls className="w-full" />
              <div className="flex gap-2">
                <button
                  className="btn flex-1 justify-center"
                  onClick={() => download(result.blob, `${projectName || 'walkthrough'}.${result.ext}`)}
                >
                  {t('walk.download')}
                </button>
              </div>
              <p className="text-[11px] text-muted">{t('walk.saveHint')}</p>
            </div>
          )}
        </div>
      )}
    </HudDialog>
  );
}

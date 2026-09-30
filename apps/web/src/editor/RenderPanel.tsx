import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, X } from 'lucide-react';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { ApiClientError, api } from '../cloud/client';
import {
  gbufferSize,
  submitRender,
  watchJob,
  type Job,
  type Render,
  type RenderSettings,
} from '../cloud/render';
import { snapshotToCloud } from '../cloud/sync';
import { useEditor, useEditorStore } from './context';

type Pricing = { render: Record<'1k' | '2k' | '4k', number>; inpaint: number; styles: string[] };
const STRICTNESS = ['free', 'balanced', 'strict'] as const;

/** AI 渲染面板（S5.10，FR-502/504）：草圖→高清、嚴格度、預估點數、進度、比較、局部重繪、未通過預覽 */
export function RenderPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="btn btn-primary whitespace-nowrap" data-testid="open-render">
          <Sparkles size={16} aria-hidden /> {t('top.render')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20" />
        <Dialog.Content
          className="fixed right-0 top-0 flex h-full w-[420px] max-w-full flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-4 shadow-xl"
          data-testid="render-panel"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">{t('render.title')}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={t('render.close')}>
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <RenderForm />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenderForm() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const selection = useEditor((s) => s.selection);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [settings, setSettings] = useState<RenderSettings>({
    styleTemplateId: 'japandi',
    strictness: 'balanced',
    resolution: '1k',
  });
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Render | null>(null);
  const [clay, setClay] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const reloadBalance = () =>
    api
      .get('/credits')
      .then((c) => setBalance(c.balance))
      .catch(() => undefined);
  useEffect(() => {
    void api
      .get('/pricing')
      .then(setPricing)
      .catch(() => undefined);
    void reloadBalance();
    return () => abort.current?.abort();
  }, []);

  const cost =
    settings.resolution === '4k' || settings.resolution === '2k' || settings.resolution === '1k'
      ? pricing?.render[settings.resolution]
      : undefined;
  const needConfirm = settings.resolution === '4k' && !settings.confirmHighRes;
  const fail = (x: unknown) =>
    setErr(
      x instanceof ApiClientError
        ? t(`render.err.${x.code}`, { defaultValue: x.message })
        : String((x as Error)?.message ?? x),
    );

  /** 送出 → SSE 追蹤 → 取結果 */
  async function run(start: () => Promise<Job>) {
    setBusy(true);
    setErr(null);
    abort.current = new AbortController();
    try {
      const j = await start();
      setJob(j);
      void reloadBalance();
      const done = await watchJob(j.id, setJob, abort.current.signal);
      setResult(await api.get('/renders/{id}', { params: { id: done.id } }));
      void reloadBalance();
    } catch (x) {
      if (!abort.current.signal.aborted) fail(x);
    } finally {
      setBusy(false);
    }
  }

  const render = () =>
    run(async () => {
      const v = viewer3dApi.get();
      if (!v) throw new Error(t('render.need3d'));
      const canvas = document.querySelector('[data-testid=viewer3d] canvas') as HTMLCanvasElement | null;
      const size = gbufferSize(canvas?.clientWidth ?? 1024, canvas?.clientHeight ?? 768);
      const g = v.gbuffer({ ...size, clay: true });
      const c = document.createElement('canvas');
      c.width = g.color.width;
      c.height = g.color.height;
      c.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(g.color.data), c.width, c.height),
        0,
        0,
      );
      setClay(c.toDataURL('image/png'));
      setResult(null);
      const s = store.getState();
      const target = await snapshotToCloud(s.projectId, s.projectName, s.scene);
      return submitRender(g, target, settings);
    });

  const inpaint = () => {
    // 局部重繪的比較基準是上一張效果圖（不是白模）
    setClay(result?.outputUrl ?? null);
    return run(() =>
      api.post('/renders/{id}/inpaint', {
        params: { id: result!.id },
        idempotencyKey: crypto.randomUUID(),
        body: { objectIds: selection, instruction },
      }),
    );
  };

  const accept = async () => {
    try {
      setResult(
        await api.post('/renders/{id}/accept', {
          params: { id: result!.id },
          idempotencyKey: `accept-${result!.id}`,
        }),
      );
      void reloadBalance();
    } catch (x) {
      fail(x);
    }
  };

  const running = busy && job && !['succeeded', 'failed', 'canceled'].includes(job.state);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span data-testid="render-balance">{t('render.balance', { n: balance ?? '—' })}</span>
        {pricing === null && <span className="text-warn">{t('render.offline')}</span>}
      </div>

      <fieldset className="space-y-2" disabled={busy}>
        <label className="block text-xs">
          {t('render.style')}
          <select
            className="field mt-1 w-full"
            value={settings.styleTemplateId}
            onChange={(e) =>
              setSettings({
                ...settings,
                styleTemplateId: e.target.value as RenderSettings['styleTemplateId'],
              })
            }
            data-testid="render-style"
          >
            {(pricing?.styles ?? ['japandi']).map((s) => (
              <option key={s} value={s}>
                {t(`render.styles.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          {t('render.strictness')}: <strong>{t(`render.strict.${settings.strictness}`)}</strong>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            className="mt-1 w-full"
            value={STRICTNESS.indexOf(settings.strictness)}
            onChange={(e) => setSettings({ ...settings, strictness: STRICTNESS[Number(e.target.value)]! })}
            aria-valuetext={t(`render.strict.${settings.strictness}`)}
            data-testid="render-strictness"
          />
          <span className="text-muted">{t(`render.strictHint.${settings.strictness}`)}</span>
        </label>
        <div role="radiogroup" aria-label={t('render.resolution')} className="flex gap-2 text-xs">
          {(['1k', '2k', '4k'] as const).map((r) => (
            <label key={r} className="flex items-center gap-1">
              <input
                type="radio"
                name="res"
                checked={settings.resolution === r}
                onChange={() => setSettings({ ...settings, resolution: r, confirmHighRes: false })}
              />
              {t(`render.res.${r}`)}
            </label>
          ))}
        </div>
        {settings.resolution === '4k' && (
          <label className="flex items-center gap-1 text-xs text-warn">
            <input
              type="checkbox"
              checked={!!settings.confirmHighRes}
              onChange={(e) => setSettings({ ...settings, confirmHighRes: e.target.checked })}
              data-testid="render-confirm4k"
            />
            {t('render.confirm4k', { n: pricing?.render['4k'] ?? '—' })}
          </label>
        )}
        <label className="block text-xs">
          {t('render.extra')} ({(settings.extra ?? '').length}/300)
          <textarea
            className="field mt-1 w-full font-sans"
            maxLength={300}
            rows={2}
            value={settings.extra ?? ''}
            onChange={(e) => setSettings({ ...settings, extra: e.target.value || undefined })}
            data-testid="render-extra"
          />
        </label>
        <button
          className="btn btn-primary w-full"
          onClick={() => void render()}
          disabled={needConfirm}
          data-testid="render-submit"
        >
          <Sparkles size={16} aria-hidden /> {t('render.submit', { n: cost ?? '—' })}
        </button>
      </fieldset>

      {job && (
        <div className="space-y-1" aria-live="polite">
          <div className="flex justify-between text-xs">
            <span data-testid="render-state" data-state={job.state}>
              {t(`render.state.${job.state}`)}
              {job.retryCount ? ` · ${t('render.retries', { n: job.retryCount })}` : ''}
            </span>
            {running && (
              <button
                className="btn px-2 py-0.5 text-xs"
                onClick={() => void api.post('/renders/{id}/cancel', { params: { id: job.id } }).catch(fail)}
              >
                {t('render.cancel')}
              </button>
            )}
          </div>
          <progress className="w-full" max={100} value={job.progress} aria-label={t('render.progress')} />
        </div>
      )}
      {err && (
        <p role="alert" className="text-xs text-danger" data-testid="render-error">
          {err}
        </p>
      )}

      {result && <ResultView result={result} clay={clay} onAccept={() => void accept()} />}

      {result?.state === 'succeeded' && (
        <fieldset className="space-y-2 border-t border-border pt-3" disabled={busy}>
          <p className="text-xs text-muted">
            {selection.length
              ? t('render.inpaintSelected', { n: selection.length })
              : t('render.inpaintHint')}
          </p>
          <input
            className="field w-full font-sans"
            maxLength={300}
            placeholder={t('render.inpaintPlaceholder')}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            aria-label={t('render.inpaintPlaceholder')}
            data-testid="inpaint-instruction"
          />
          <button
            className="btn w-full"
            disabled={!selection.length || !instruction.trim()}
            onClick={() => void inpaint()}
            data-testid="inpaint-submit"
          >
            {t('render.inpaint', { n: pricing?.inpaint ?? '—' })}
          </button>
        </fieldset>
      )}
    </div>
  );
}

/** 結果：與 clay 比較（滑桿）；未通過驗證 → 浮水印預覽＋「仍要使用」 */
function ResultView({
  result,
  clay,
  onAccept,
}: {
  result: Render;
  clay: string | null;
  onAccept: () => void;
}) {
  const { t } = useTranslation();
  const [split, setSplit] = useState(50);
  const img = result.outputUrl ?? result.previewUrl;
  return (
    <div
      className="space-y-2"
      data-testid="render-result"
      data-render-state={result.state}
      data-kind={result.kind}
    >
      {result.kind === 'inpaint' && result.state === 'succeeded' && (
        <p className="text-xs text-muted" data-testid="render-validation">
          {t('render.inpaintDone')}
        </p>
      )}
      {result.kind === 'render' && result.validation && (
        <p className="text-xs text-muted" data-testid="render-validation">
          {t('render.validation', {
            score: result.validation.score ?? '—',
            threshold: result.validation.threshold,
          })}
          {!result.validation.calibrated && ` · ${t('render.uncalibrated')}`}
        </p>
      )}
      {img && (
        <div className="relative overflow-hidden rounded-md border border-border">
          <img src={img} alt={t('render.resultAlt')} className="block w-full" data-testid="render-image" />
          {clay && result.outputUrl && (
            <img
              src={clay}
              alt={t('render.clayAlt')}
              className="absolute inset-0 h-full w-full"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            />
          )}
        </div>
      )}
      {clay && result.outputUrl && (
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="w-full"
          aria-label={t('render.compare')}
          data-testid="render-compare"
        />
      )}
      {result.state === 'failed' && (
        <div className="space-y-1 text-xs">
          <p className="text-danger">
            {t(`render.err.${result.errorCode ?? 'JOB_FAILED'}`, { defaultValue: result.errorMessage ?? '' })}
          </p>
          {result.previewUrl && !result.accepted && (
            <button className="btn" onClick={onAccept} data-testid="render-accept">
              {t('render.accept', { n: result.costCredits })}
            </button>
          )}
        </div>
      )}
      {result.outputUrl && (
        <a
          className="btn inline-block"
          href={result.outputUrl}
          download={`render-${result.id}.png`}
          target="_blank"
          rel="noreferrer"
        >
          {t('render.download')}
        </a>
      )}
    </div>
  );
}

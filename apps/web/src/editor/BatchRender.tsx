import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, RotateCcw, Square } from 'lucide-react';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { api } from '../cloud/client';
import { gbufferSize, submitRender, watchJob, type RenderSettings } from '../cloud/render';
import { snapshotToCloud } from '../cloud/sync';
import { addToGallery } from '../media';
import { useEditor, useEditorStore } from './context';

type State = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
interface Item {
  camId: string;
  name: string;
  state: State;
  progress?: number;
  error?: string;
}
const NO_CAMS: never[] = [];
const frame = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));

/**
 * 批次渲染（FE-RND-03）：勾選多個相機書籤一次送出，依序出圖；佇列顯示進度、失敗可重試、可取消；
 * 完成的效果圖自動存入圖庫（依書籤命名）。
 */
export function BatchRender({ settings }: { settings: RenderSettings }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const cams = useEditor((s) => s.scene.cameras) ?? NO_CAMS;
  const [picked, setPicked] = useState<string[]>([]);
  const [queue, setQueue] = useState<Item[]>([]);
  const cancel = useRef<AbortController | null>(null);
  const running = queue.some((q) => q.state === 'running');
  const patch = (camId: string, p: Partial<Item>) =>
    setQueue((q) => q.map((x) => (x.camId === camId ? { ...x, ...p } : x)));

  const renderOne = async (
    camId: string,
    target: Awaited<ReturnType<typeof snapshotToCloud>>,
    signal: AbortSignal,
  ) => {
    const cam = store.getState().scene.cameras?.find((c) => c.id === camId);
    const v = viewer3dApi.get();
    if (!cam || !v) throw new Error(t('render.need3d'));
    patch(camId, { state: 'running', progress: 0, error: undefined });
    v.setCamera(cam);
    await frame();
    const canvas = document.querySelector('[data-testid=viewer3d] canvas') as HTMLCanvasElement | null;
    const g = v.gbuffer({
      ...gbufferSize(canvas?.clientWidth ?? 1024, canvas?.clientHeight ?? 768),
      clay: true,
    });
    const job = await submitRender(g, target, settings);
    const done = await watchJob(job.id, (j) => patch(camId, { progress: j.progress ?? 0 }), signal);
    const r = await api.get('/renders/{id}', { params: { id: done.id } });
    const url = r.outputUrl ?? r.previewUrl;
    if (url) {
      const blob = await (await fetch(url)).blob();
      await addToGallery(store.getState().projectId, {
        kind: 'render',
        name: `${t('batch.prefix')} · ${cam.name}`,
        blob,
      });
    }
    patch(camId, { state: 'done', progress: 100 });
  };

  const runAll = async (ids: string[]) => {
    cancel.current = new AbortController();
    const signal = cancel.current.signal;
    setQueue((q) => {
      const rest = q.filter((x) => !ids.includes(x.camId));
      return [
        ...rest,
        ...ids.map((id) => ({
          camId: id,
          name: cams.find((c) => c.id === id)?.name ?? id,
          state: 'queued' as State,
        })),
      ];
    });
    const s = store.getState();
    let target: Awaited<ReturnType<typeof snapshotToCloud>>;
    try {
      target = await snapshotToCloud(s.projectId, s.projectName, s.scene);
    } catch (e) {
      for (const id of ids) patch(id, { state: 'failed', error: String((e as Error).message ?? e) });
      return;
    }
    for (const id of ids) {
      if (signal.aborted) {
        patch(id, { state: 'canceled' });
        continue;
      }
      try {
        await renderOne(id, target, signal);
      } catch (e) {
        patch(
          id,
          signal.aborted
            ? { state: 'canceled' }
            : { state: 'failed', error: String((e as Error).message ?? e) },
        );
      }
    }
  };

  if (!cams.length) return <p className="text-xs text-muted">{t('batch.noCams')}</p>;
  return (
    <section className="hud-section space-y-2 p-2 text-xs" data-testid="batch-render">
      <p className="flex items-center gap-1 font-bold text-primary">
        <Layers size={12} aria-hidden /> {t('batch.title')}
      </p>
      <ul className="grid grid-cols-2 gap-1">
        {cams.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))
                }
                data-testid={`batch-cam-${c.id}`}
              />
              <span className="truncate">{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <button
          className="btn flex-1 justify-center"
          disabled={!picked.length || running}
          onClick={() => void runAll(picked)}
          data-testid="batch-run"
        >
          {t('batch.run', { n: picked.length })}
        </button>
        {running && (
          <button className="btn" onClick={() => cancel.current?.abort()} data-testid="batch-cancel">
            <Square size={12} aria-hidden /> {t('batch.cancel')}
          </button>
        )}
      </div>
      {queue.length > 0 && (
        <ol className="space-y-1" data-testid="batch-queue">
          {queue.map((q) => (
            <li key={q.camId} className="flex items-center gap-2" data-state={q.state}>
              <span className="flex-1 truncate">{q.name}</span>
              <span className="w-24">
                <span className="block h-1.5 rounded bg-border">
                  <span
                    className="block h-full rounded bg-primary"
                    style={{ width: `${q.state === 'done' ? 100 : (q.progress ?? 0)}%` }}
                  />
                </span>
              </span>
              <span className={q.state === 'failed' ? 'text-danger' : 'text-muted'} title={q.error}>
                {t(`batch.states.${q.state}`)}
              </span>
              {(q.state === 'failed' || q.state === 'canceled') && !running && (
                <button className="icon-btn" title={t('batch.retry')} onClick={() => void runAll([q.camId])}>
                  <RotateCcw size={12} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

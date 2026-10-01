import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Check, Ruler, Trash2 } from 'lucide-react';
import { createEditorStore, importPlan, saveProject, type ImportSkip } from '@interiorai/app-state';
import {
  LOW_CONFIDENCE,
  calibrate,
  defaultMmPerUnit,
  imageTransform,
  labelRoomsHeuristic,
  pending,
  toImport,
  type PlanResult,
} from './geometry';
import { deleteSession, loadSession, type ImportSession } from './local';

type P = [number, number];

/**
 * 平面圖校正（S6.6、FR-103/104）：底圖＋辨識結果疊圖；信心 < 0.6 紅框並列入待確認；
 * 尺度校正必經（兩點＋實際長度，或確認 DXF 的尺度）；直角吸附；建立 2D/3D 專案。
 * 匯入工作階段存在本機（不需登入）。
 */
export function PlanReviewPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [session, setSession] = useState<ImportSession | null | 'missing'>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void loadSession(id ?? '').then((s) => !dead && setSession(s ?? 'missing'));
    return () => {
      dead = true;
    };
  }, [id]);
  useEffect(() => {
    if (!session || session === 'missing' || !session.image) return;
    const url = URL.createObjectURL(session.image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [session]);

  return (
    <main className="game-ui flex h-full flex-col">
      <header className="hud-bar flex h-12 shrink-0 items-center gap-2 px-3">
        <Link to="/" className="icon-btn" aria-label={t('top.back')}>
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <h1 className="hud-title">{t('planImport.reviewTitle')}</h1>
        <span className="text-xs text-muted">{session && session !== 'missing' ? session.fileName : ''}</span>
        {session && session !== 'missing' && (
          <span className="ml-auto text-[11px] text-muted" data-testid="plan-engine">
            {t(`planImport.engine.${session.engine}`)}
          </span>
        )}
      </header>
      {session === null ? (
        <div className="grid flex-1 place-items-center" aria-live="polite" data-testid="plan-progress">
          <p>{t('planImport.analyzing')}</p>
        </div>
      ) : session === 'missing' ? (
        <div className="p-6" role="alert" data-testid="plan-failed">
          <p className="text-danger">{t('planImport.missing')}</p>
          <Link to="/" className="btn mt-3">
            {t('top.back')}
          </Link>
        </div>
      ) : (
        <Review session={session} imageUrl={imageUrl} />
      )}
    </main>
  );
}

function Review({ session, imageUrl }: { session: ImportSession; imageUrl: string | null }) {
  const result = session.result as unknown as PlanResult;
  const { t } = useTranslation();
  const nav = useNavigate();
  const tf = useMemo(() => imageTransform(result), [result]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [mmPerUnit, setMmPerUnit] = useState<number | null>(defaultMmPerUnit(result));
  const [scaleOk, setScaleOk] = useState(false);
  const [orthogonal, setOrthogonal] = useState(true);
  const [calib, setCalib] = useState<{ pts: P[]; active: boolean }>({ pts: [], active: false });
  const [lengthMm, setLengthMm] = useState('');
  const [skipped, setSkipped] = useState<ImportSkip[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // 顯示範圍：有底圖＝影像像素；向量＝牆的外框（結果座標）
  const im = result.image as { width?: number; height?: number } | null;
  const view = useMemo(() => {
    if (tf.hasImage && im?.width && im?.height) return [0, 0, im.width, im.height] as const;
    const xs = result.walls.flatMap((w) => [w.a[0]!, w.b[0]!]);
    const ys = result.walls.flatMap((w) => [w.a[1]!, w.b[1]!]);
    const pad = (Math.max(...xs) - Math.min(...xs)) * 0.05 + 1;
    return [
      Math.min(...xs) - pad,
      Math.min(...ys) - pad,
      Math.max(...xs) - Math.min(...xs) + 2 * pad,
      Math.max(...ys) - Math.min(...ys) + 2 * pad,
    ] as const;
  }, [result, tf.hasImage, im]);
  const unitPx = tf.hasImage
    ? 1 / (result.units === 'mm' && result.scale.mmPerPx ? result.scale.mmPerPx : 1)
    : 1;
  const todo = pending(result).filter((x) => !removed.has(x.id) && !confirmed.has(x.id));
  const walls = new Map(result.walls.map((w) => [w.id, w]));

  const toSvg = (e: React.MouseEvent): P | null => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const p = el.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(ctm.inverse());
    return [q.x, q.y];
  };
  const onCanvasClick = (e: React.MouseEvent) => {
    if (!calib.active) return;
    const p = toSvg(e);
    if (!p) return;
    const pts = [...calib.pts, tf.fromImage(p)].slice(-2) as P[];
    setCalib({ pts, active: pts.length < 2 });
    if (pts.length === 2 && result.scale.suggestedMmPerPx && result.units === 'px' && !lengthMm) {
      setLengthMm(
        String(
          Math.round(
            Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]) * result.scale.suggestedMmPerPx,
          ),
        ),
      );
    }
  };
  const applyCalib = () => {
    const L = Number(lengthMm);
    if (calib.pts.length !== 2 || !(L > 0)) return;
    setMmPerUnit(calibrate(calib.pts[0]!, calib.pts[1]!, L));
    setScaleOk(true);
  };

  const build = async () => {
    if (!mmPerUnit || building) return;
    setBuilding(true);
    setBuildErr(null);
    try {
      await buildProject(mmPerUnit);
    } catch (e) {
      setBuildErr(e instanceof Error ? e.message : String(e));
      setBuilding(false);
    }
  };
  const buildProject = async (mmPerUnit: number) => {
    const name = session.fileName.replace(/\.[a-z0-9]+$/i, '') || t('projects.untitled');
    const store = createEditorStore({ projectName: name });
    const s = store.getState();
    let skip: ImportSkip[] = [];
    const labeled = labelRoomsHeuristic(result, mmPerUnit, {
      living: t('planImport.rooms.living'),
      bath: t('planImport.rooms.bath'),
      bedroom: (n) => t('planImport.rooms.bedroom', { n }),
    });
    s.exec(importPlan(s.levelId, toImport(labeled, mmPerUnit, { orthogonal, removed }), (x) => (skip = x)));
    setSkipped(skip);
    const st = store.getState();
    await saveProject({ id: st.projectId, name: st.projectName, scene: st.scene });
    void deleteSession(session.id);
    void nav(`/p/${st.projectId}/edit?view=3d`);
  };

  const P2 = (p: number[]) => tf.toImage([p[0]!, p[1]!]);
  const color = (id: string, c: number) =>
    focus === id ? 'var(--accent)' : c < LOW_CONFIDENCE && !confirmed.has(id) ? '#dc2626' : '#16a34a';

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1 bg-[var(--bg)] p-3">
        <svg
          ref={svg}
          viewBox={view.join(' ')}
          className={`h-full w-full ${calib.active ? 'cursor-crosshair' : ''}`}
          onClick={onCanvasClick}
          data-testid="plan-canvas"
          data-view={view.join(',')}
          role="img"
          aria-label={t('planImport.canvas')}
        >
          {tf.hasImage && imageUrl && (
            <image href={imageUrl} x={0} y={0} width={im?.width} height={im?.height} opacity={0.55} />
          )}
          {result.rooms?.map((r, i) => (
            <polygon
              key={`r${i}`}
              points={r.polygon.map((p) => P2(p).join(',')).join(' ')}
              fill="rgba(47,93,80,0.06)"
              stroke="none"
            />
          ))}
          {result.walls
            .filter((w) => !removed.has(w.id))
            .map((w) => {
              const a = P2(w.a);
              const b = P2(w.b);
              return (
                <line
                  key={w.id}
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke={color(w.id, w.confidence)}
                  strokeOpacity={0.8}
                  strokeWidth={Math.max(2, w.thickness * unitPx)}
                  data-conf={w.confidence}
                />
              );
            })}
          {result.openings
            .filter((o) => !removed.has(o.id) && !removed.has(o.wallId))
            .map((o) => {
              const w = walls.get(o.wallId);
              if (!w) return null;
              const L = Math.hypot(w.b[0]! - w.a[0]!, w.b[1]! - w.a[1]!) || 1;
              const at = (d: number) =>
                P2([w.a[0]! + ((w.b[0]! - w.a[0]!) * d) / L, w.a[1]! + ((w.b[1]! - w.a[1]!) * d) / L]);
              const a = at(o.offset);
              const b = at(o.offset + o.width);
              const low = o.confidence < LOW_CONFIDENCE && !confirmed.has(o.id);
              return (
                <line
                  key={o.id}
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke={
                    focus === o.id
                      ? 'var(--accent)'
                      : low
                        ? '#dc2626'
                        : o.type === 'window'
                          ? '#0891b2'
                          : '#2563eb'
                  }
                  strokeWidth={Math.max(3, w.thickness * unitPx * 1.4)}
                  strokeDasharray={low ? '6 3' : undefined}
                />
              );
            })}
          {calib.pts.map((p, i) => {
            const q = tf.toImage(p);
            return <circle key={i} cx={q[0]} cy={q[1]} r={Math.max(3, view[2] / 150)} fill="#f59e0b" />;
          })}
          {calib.pts.length === 2 && (
            <line
              x1={tf.toImage(calib.pts[0]!)[0]}
              y1={tf.toImage(calib.pts[0]!)[1]}
              x2={tf.toImage(calib.pts[1]!)[0]}
              y2={tf.toImage(calib.pts[1]!)[1]}
              stroke="#f59e0b"
              strokeWidth={Math.max(2, view[2] / 300)}
            />
          )}
        </svg>
      </div>

      <aside
        className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-border bg-surface p-3 text-sm"
        aria-label={t('planImport.panel')}
      >
        <section className="space-y-2" data-testid="scale-section">
          <h2 className="panel-title">{t('planImport.scale')}</h2>
          <p className="text-xs text-muted">
            {t(`planImport.scaleMethod.${result.scale.method}`)}
            {mmPerUnit ? ` · ${t('planImport.mmPerUnit', { v: mmPerUnit.toFixed(3), u: result.units })}` : ''}
          </p>
          {(result.warnings ?? []).map((w) => (
            <p key={w.code} className="text-xs text-warn">
              {w.message}
            </p>
          ))}
          <button
            className="btn w-full"
            onClick={() => setCalib({ pts: [], active: true })}
            data-testid="calib-start"
          >
            <Ruler size={14} aria-hidden />{' '}
            {calib.active
              ? t('planImport.calibClick', { n: calib.pts.length + 1 })
              : t('planImport.calibStart')}
          </button>
          {calib.pts.length === 2 && (
            <div className="flex items-end gap-2">
              <label className="grid flex-1 gap-1 text-xs">
                {t('planImport.realLength')}
                <input
                  className="field"
                  inputMode="numeric"
                  value={lengthMm}
                  onChange={(e) => setLengthMm(e.target.value)}
                  data-testid="calib-length"
                />
              </label>
              <button className="btn" onClick={applyCalib} data-testid="calib-apply">
                {t('planImport.apply')}
              </button>
            </div>
          )}
          {!mmPerUnit && result.scale.suggestedMmPerPx && (
            <button
              className="btn w-full"
              onClick={() => setMmPerUnit(result.scale.suggestedMmPerPx!)}
              data-testid="scale-suggested"
            >
              {t('planImport.useSuggested', { v: result.scale.suggestedMmPerPx.toFixed(2) })}
            </button>
          )}
          {mmPerUnit && !scaleOk && (
            <button className="btn w-full" onClick={() => setScaleOk(true)} data-testid="scale-confirm">
              <Check size={14} aria-hidden /> {t('planImport.confirmScale')}
            </button>
          )}
          {scaleOk && (
            <p className="text-xs text-ok" data-testid="scale-ok">
              {t('planImport.scaleConfirmed')}
            </p>
          )}
        </section>

        <section className="space-y-1">
          <h2 className="panel-title">{t('planImport.pending', { n: todo.length })}</h2>
          {todo.length === 0 && <p className="text-xs text-muted">{t('planImport.noPending')}</p>}
          <ul className="space-y-1">
            {todo.map((x) => (
              <li
                key={x.id}
                className="flex items-center gap-2 rounded border border-border px-2 py-1"
                onMouseEnter={() => setFocus(x.id)}
                onMouseLeave={() => setFocus(null)}
                data-testid="pending-item"
              >
                <span className="flex-1 text-xs">
                  {t(`planImport.kind.${x.kind}`)} · {Math.round(x.confidence * 100)}%
                </span>
                <button
                  className="icon-btn"
                  aria-label={t('planImport.accept')}
                  onClick={() => setConfirmed(new Set([...confirmed, x.id]))}
                >
                  <Check size={14} aria-hidden />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('planImport.delete')}
                  onClick={() => setRemoved(new Set([...removed, x.id]))}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1 text-xs">
          <p>
            {t('planImport.counts', {
              w: result.walls.length - [...removed].filter((r) => walls.has(r)).length,
              o: result.openings.length,
              r: result.rooms?.length ?? 0,
            })}
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={orthogonal} onChange={(e) => setOrthogonal(e.target.checked)} />{' '}
            {t('planImport.orthogonal')}
          </label>
        </section>

        <button
          className="btn btn-primary w-full"
          disabled={!scaleOk || !mmPerUnit || building}
          onClick={() => void build()}
          data-testid="build-3d"
        >
          {t('planImport.build')}
        </button>
        {!scaleOk && <p className="text-xs text-muted">{t('planImport.needScale')}</p>}
        {buildErr && (
          <p role="alert" className="text-xs text-danger" data-testid="build-failed">
            {t('planImport.buildFailed', { message: buildErr })}
          </p>
        )}
        {skipped && skipped.length > 0 && (
          <p className="text-xs text-warn">{t('planImport.skipped', { n: skipped.length })}</p>
        )}
      </aside>
    </div>
  );
}

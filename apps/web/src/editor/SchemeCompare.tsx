import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scene } from '@interiorai/scene-schema';
import { catalog } from '../catalogData';
import { planToSvg } from '../export/plan';
import { listVersions, type VersionRecord } from '../media';
import { ROOM_KIND_FILL } from '@interiorai/editor-2d';
import { useEditor } from './context';
import { HudDialog } from './HudDialog';
import { buildQuote } from './quote';

/** 方案差異摘要（純函式）：物件新增／刪除／移動數、件數、報價總額 */
export function schemeDiff(a: Scene, b: Scene) {
  const objs = (s: Scene) => new Map(s.levels.flatMap((l) => l.objects.map((o) => [o.id, o] as const)));
  const A = objs(a);
  const B = objs(b);
  let added = 0;
  let removed = 0;
  let moved = 0;
  for (const [id, o] of B) {
    const p = A.get(id);
    if (!p) added++;
    else if (
      p.position.some((v, i) => Math.abs(v - o.position[i]!) > 1) ||
      Math.abs(p.rotationY - o.rotationY) > 1e-3 ||
      p.catalogId !== o.catalogId
    )
      moved++;
  }
  for (const id of A.keys()) if (!B.has(id)) removed++;
  return { added, removed, moved, countA: A.size, countB: B.size };
}

type Pick = 'current' | string;

/**
 * 方案比較（FE-SHR-05）：目前設計與已存版本任選兩個，並排或滑桿比較（彩色平面圖＋3D 縮圖），
 * 並列出件數、報價總額與物件差異。
 */
export function SchemeCompare({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const projectId = useEditor((s) => s.projectId);
  const current = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [a, setA] = useState<Pick>('');
  const [b, setB] = useState<Pick>('current');
  const [mode, setMode] = useState<'side' | 'slider'>('side');
  const [split, setSplit] = useState(50);
  const [view, setView] = useState<'plan' | 'photo'>('plan');
  useEffect(() => {
    if (!open) return;
    void listVersions(projectId).then((v) => {
      setVersions(v);
      setA((x) => x || v[0]?.id || 'current');
    });
  }, [open, projectId]);
  const sceneOf = (p: Pick): { scene: Scene; thumb?: string; name: string } | null => {
    if (p === 'current') return { scene: current, name: t('compare.current') };
    const v = versions.find((x) => x.id === p);
    return v ? { scene: v.scene, thumb: v.thumb, name: v.name } : null;
  };
  const A = sceneOf(a);
  const B = sceneOf(b);
  const nameOf = (id: string) => {
    const e = catalog.get(id);
    return (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? id;
  };
  const planUrl = (s: Scene) => {
    const lv = s.levels.find((l) => l.id === levelId) ?? s.levels[0]!;
    if (!lv.walls.length) return null;
    const svg = planToSvg(lv, catalog, { nameOf, roomFill: (k) => ROOM_KIND_FILL[k ?? 'other'] ?? '#eee' });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const imgs = useMemo(
    () =>
      A && B ? [A, B].map((x) => (view === 'plan' ? planUrl(x.scene) : (x.thumb ?? null))) : [null, null],
    [A?.scene, B?.scene, view, A?.thumb, B?.thumb], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const stats = useMemo(() => {
    if (!A || !B) return null;
    const qa = buildQuote(A.scene, i18n.language);
    const qb = buildQuote(B.scene, i18n.language);
    return { ...schemeDiff(A.scene, B.scene), totalA: qa.total, totalB: qb.total };
  }, [A?.scene, B?.scene, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = [
    { value: 'current', label: t('compare.current') },
    ...versions.map((v) => ({ value: v.id, label: `${v.name} · ${new Date(v.at).toLocaleString()}` })),
  ];
  const sel = (value: string, set: (v: string) => void, testId: string) => (
    <select
      className="field min-w-0 flex-1"
      value={value}
      onChange={(e) => set(e.target.value)}
      data-testid={testId}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const img = (u: string | null, alt: string) =>
    u ? (
      <img src={u} alt={alt} className="block h-full w-full bg-white object-contain" draggable={false} />
    ) : (
      <div className="grid h-full place-items-center text-xs text-muted">{t('compare.noImage')}</div>
    );
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('compare.title')}
      testId="scheme-compare"
      width={1040}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-primary">A</span>
        {sel(a, setA, 'compare-a')}
        <span className="font-bold text-accent">B</span>
        {sel(b, setB, 'compare-b')}
        <div className="hud-seg">
          {(['side', 'slider'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              data-testid={`compare-mode-${m}`}
            >
              {t(`compare.modes.${m}`)}
            </button>
          ))}
        </div>
        <div className="hud-seg">
          {(['plan', 'photo'] as const).map((m) => (
            <button key={m} aria-pressed={view === m} onClick={() => setView(m)}>
              {t(`compare.views.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {mode === 'side' ? (
        <div className="grid h-[52vh] grid-cols-2 gap-2" data-testid="compare-side">
          {[0, 1].map((i) => (
            <figure key={i} className="flex min-h-0 flex-col border border-border">
              <figcaption className="px-2 py-1 text-xs">
                <b className={i ? 'text-accent' : 'text-primary'}>{i ? 'B' : 'A'}</b> {(i ? B : A)?.name}
              </figcaption>
              <div className="min-h-0 flex-1">{img(imgs[i] ?? null, i ? 'B' : 'A')}</div>
            </figure>
          ))}
        </div>
      ) : (
        <div className="relative h-[52vh] border border-border" data-testid="compare-slider">
          <div className="absolute inset-0">{img(imgs[0] ?? null, 'A')}</div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            {img(imgs[1] ?? null, 'B')}
          </div>
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-primary"
            style={{ left: `${split}%` }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            className="hud-range absolute right-3 bottom-2 left-3"
            aria-label={t('compare.slider')}
          />
        </div>
      )}
      {stats && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4" data-testid="compare-stats">
          <dt className="text-muted">{t('compare.items')}</dt>
          <dd>
            {stats.countA} → {stats.countB}
          </dd>
          <dt className="text-muted">{t('compare.total')}</dt>
          <dd>
            {Math.round(stats.totalA).toLocaleString()} → {Math.round(stats.totalB).toLocaleString()}
          </dd>
          <dt className="text-muted">{t('compare.changes')}</dt>
          <dd data-testid="compare-changes">
            {t('compare.diff', { added: stats.added, removed: stats.removed, moved: stats.moved })}
          </dd>
        </dl>
      )}
    </HudDialog>
  );
}

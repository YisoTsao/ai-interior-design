import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Wand2 } from 'lucide-react';
import {
  activeLevel,
  autoDecorate,
  FURNISH_STYLES,
  furnishVariants,
  type FurnishProposal,
  type FurnishStyle,
  type Placement,
} from '@interiorai/app-state';
import { objectDims } from '@interiorai/catalog';
import { objectFootprint } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';
import { catalog } from '../catalogData';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

const DEFAULT_STYLES: FurnishStyle[] = ['nordic', 'modern', 'luxury'];

/** 提案的平面預覽：牆（線）、既有家具（灰）、新家具（主色） */
export function PlanPreview({ level, placements }: { level: Level; placements: readonly Placement[] }) {
  const pts = level.walls.flatMap((w) => [w.a, w.b]);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const pad = 400;
  const poly = (
    o: Pick<Placement, 'catalogId' | 'position' | 'rotationY'> & { params?: Placement['params'] },
  ) => {
    const e = catalog.get(o.catalogId);
    if (!e || e.anchor !== 'floor') return null;
    const d = objectDims(e, o.params);
    return objectFootprint(o.position, o.rotationY, d.w, d.d)
      .map((p) => `${p[0]},${p[1]}`)
      .join(' ');
  };
  return (
    <svg
      viewBox={`${x0 - pad} ${z0 - pad} ${x1 - x0 + pad * 2} ${z1 - z0 + pad * 2}`}
      className="aspect-[4/3] w-full rounded bg-bg"
      role="img"
      aria-hidden
    >
      {level.walls.map((w) => (
        <line
          key={w.id}
          x1={w.a[0]}
          y1={w.a[1]}
          x2={w.b[0]}
          y2={w.b[1]}
          stroke="var(--wall)"
          strokeWidth={w.thickness}
          strokeLinecap="square"
          opacity={0.8}
        />
      ))}
      {level.objects.map((o) => {
        const p = poly(o);
        return p ? <polygon key={o.id} points={p} fill="currentColor" opacity={0.25} /> : null;
      })}
      {placements.map((o, i) => {
        const p = poly(o);
        return p ? (
          <polygon
            key={i}
            points={p}
            fill="var(--accent)"
            fillOpacity={0.55}
            stroke="var(--accent)"
            strokeWidth={30}
          />
        ) : null;
      })}
    </svg>
  );
}

/**
 * AI 自動佈置（FE-AI-02）：選範圍（全部房間／選取的房間）、風格、預算 → 產生三種風格提案 →
 * 平面預覽比較 → 擇一套用（單一 Undo）。
 */
export function FurnishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const level = useEditor(activeLevel);
  const selection = useEditor((s) => s.selection);
  const selectedRooms = useMemo(
    () => level.rooms.filter((r) => selection.includes(r.id)).map((r) => r.id),
    [level, selection],
  );
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [styles, setStyles] = useState<FurnishStyle[]>(DEFAULT_STYLES);
  const [budget, setBudget] = useState('');
  const [includeFurnished, setIncludeFurnished] = useState(false);
  const [pick, setPick] = useState(0);
  const [variants, setVariants] = useState<FurnishProposal[] | null>(null);

  const generate = () => {
    const b = Number(budget);
    setVariants(
      furnishVariants(level, catalog, {
        styles,
        ...(b > 0 ? { budget: b } : {}),
        ...(scope === 'selected' && selectedRooms.length ? { roomIds: selectedRooms } : {}),
        includeFurnished,
      }),
    );
    setPick(0);
  };
  const apply = () => {
    const v = variants?.[pick];
    if (!v?.placements.length) return;
    const s = store.getState();
    if (s.exec(autoDecorate(s.levelId, v.placements))) {
      s.notify(
        'info',
        t('furnish.applied', { n: v.placements.length, style: t(`furnish.style.${v.style}`) }),
      );
      onOpenChange(false);
      setVariants(null);
    }
  };
  const money = (n: number) => `NT$ ${n.toLocaleString()}`;

  return (
    <HudDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setVariants(null);
      }}
      title={t('furnish.title')}
      testId="furnish-dialog"
      width={960}
      footer={
        <>
          <button className="btn" onClick={generate} data-testid="furnish-generate">
            <Wand2 size={16} aria-hidden /> {variants ? t('furnish.regenerate') : t('furnish.generate')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!variants?.[pick]?.placements.length}
            onClick={apply}
            data-testid="furnish-apply"
          >
            <Sparkles size={16} aria-hidden /> {t('furnish.apply')}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">{t('furnish.desc')}</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="hud-seg" role="radiogroup" aria-label={t('furnish.scope')}>
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            {t('furnish.scopeAll')}
          </button>
          <button
            aria-pressed={scope === 'selected'}
            disabled={!selectedRooms.length}
            onClick={() => setScope('selected')}
            title={selectedRooms.length ? undefined : t('furnish.scopeHint')}
          >
            {t('furnish.scopeSelected', { n: selectedRooms.length })}
          </button>
        </div>
        <label className="text-xs">
          <span className="mb-1 block text-muted">{t('furnish.budget')}</span>
          <input
            className="field w-36"
            type="number"
            min={0}
            step={10000}
            placeholder={t('furnish.noBudget')}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            data-testid="furnish-budget"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeFurnished}
            onChange={(e) => setIncludeFurnished(e.target.checked)}
          />
          {t('furnish.includeFurnished')}
        </label>
      </div>
      <fieldset className="mb-3">
        <legend className="mb-1 text-xs text-muted">{t('furnish.styleLabel')}</legend>
        <div className="flex flex-wrap gap-1">
          {FURNISH_STYLES.map((s) => (
            <button
              key={s}
              className="hud-chip"
              aria-pressed={styles.includes(s)}
              onClick={() =>
                setStyles((cur) =>
                  cur.includes(s)
                    ? cur.length > 1
                      ? cur.filter((x) => x !== s)
                      : cur
                    : [...cur, s].slice(-3),
                )
              }
            >
              {t(`furnish.style.${s}`)}
            </button>
          ))}
        </div>
      </fieldset>
      {variants && (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
          role="radiogroup"
          data-testid="furnish-variants"
        >
          {variants.map((v, i) => (
            <li key={v.style}>
              <button
                className="inv-slot w-full p-2 text-left"
                data-active={pick === i}
                aria-pressed={pick === i}
                onClick={() => setPick(i)}
                data-testid={`furnish-variant-${i}`}
              >
                <PlanPreview level={level} placements={v.placements} />
                <span className="mt-2 block text-sm font-medium">{t(`furnish.style.${v.style}`)}</span>
                <span className="block text-xs text-muted">
                  {t('furnish.summary', { n: v.placements.length, cost: money(v.cost) })}
                </span>
                <span className="mt-1 block text-[11px] text-muted">
                  {v.rooms
                    .filter((r) => r.count)
                    .map((r) => `${r.label ?? t(`roomKinds.${r.kind}`)} ×${r.count}`)
                    .join(' · ') || t('furnish.nothing')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HudDialog>
  );
}

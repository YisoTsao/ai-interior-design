import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, X } from 'lucide-react';
import { updateObject } from '@interiorai/app-state';
import { objectDims, resolveParams, type CatalogEntry } from '@interiorai/catalog';
import type { SceneObject } from '@interiorai/scene-schema';
import { parseCabinetLayout } from '@interiorai/viewer-3d';
import { useEditorStore } from './context';
import { HudDialog } from './HudDialog';

type Cell = 'd' | 'dr' | 'o' | 'h';
const CELLS: Cell[] = ['d', 'dr', 'o', 'h'];
const HANDLES = ['bar', 'knob', 'groove', 'none'] as const;
const PRESETS: Record<string, string> = {
  wardrobe: 'h,dr,dr|o,o,o,o|h,dr,dr',
  bookcase: 'o,o,o,o|o,o,o,o|d',
  sideboard: 'd|dr,dr,dr|d',
  tv: 'dr|o|dr',
  shoe: 'd,d|d,d',
};

/**
 * 訂製櫃設計器（FE-AST-07）：尺寸、分欄（1–8）、每欄由上而下的格位（門片／抽屜／開放／吊衣桿）、把手樣式；
 * 正視圖即時預覽，套用後 3D 同步（一次 undo）。
 */
export function CabinetDesigner({
  open,
  onOpenChange,
  obj,
  entry,
  levelId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  obj: SceneObject;
  entry: CatalogEntry;
  levelId: string;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const r = resolveParams(entry, obj.params);
  const dims = objectDims(entry, obj.params);
  const [cols, setCols] = useState<Cell[][]>([]);
  const [handle, setHandle] = useState<(typeof HANDLES)[number]>('bar');
  const [size, setSize] = useState({ w: dims.w, h: dims.h, d: dims.d });
  useEffect(() => {
    if (!open) return;
    const init = typeof r.x_layout === 'string' ? parseCabinetLayout(r.x_layout) : [];
    setCols((init.length ? init : parseCabinetLayout(PRESETS.wardrobe!)) as Cell[][]);
    setHandle(
      (HANDLES as readonly string[]).includes(String(r.x_handle))
        ? (r.x_handle as (typeof HANDLES)[number])
        : 'bar',
    );
    setSize({ w: dims.w, h: dims.h, d: dims.d });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = entry.model.kind === 'parametric' ? entry.model.params : {};
  const range = (k: 'w' | 'h' | 'd') => {
    const p = spec[k];
    return p && p.type === 'integer' ? [p.min ?? 100, p.max ?? 5000] : [100, 5000];
  };
  const apply = () => {
    const layout = cols.map((c) => c.join(',')).join('|');
    const params: Record<string, unknown> = { ...(obj.params ?? {}), x_layout: layout, x_handle: handle };
    for (const k of ['w', 'h', 'd'] as const) if (spec[k]) params[k] = size[k];
    store.getState().exec(updateObject(levelId, obj.id, { params }));
    onOpenChange(false);
  };
  // 正視圖預覽（與 3D 幾何同樣的分配規則）
  const PL = 80;
  const T = 18;
  const cw = (size.w - T) / Math.max(1, cols.length);
  const innerH = size.h - PL - 2 * T;
  const svgCells = cols.flatMap((rows, ci) => {
    const fixedH = rows.filter((x) => x === 'dr').length * 200;
    const flexN = rows.filter((x) => x !== 'dr').length;
    const flexH = flexN ? Math.max(150, (innerH - fixedH) / flexN) : 0;
    let top = T;
    return rows.map((c, ri) => {
      const hh = c === 'dr' ? 200 : flexH;
      const y = top;
      top += hh + T;
      return { ci, ri, c, x: T / 2 + cw * ci, y, w: cw, h: hh };
    });
  });
  const setCell = (ci: number, ri: number, v: Cell) =>
    setCols(cols.map((c, i) => (i === ci ? c.map((x, j) => (j === ri ? v : x)) : c)));
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('cabinet.title')}
      testId="cabinet-designer"
      width={900}
      footer={
        <>
          <button className="btn" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={apply} data-testid="cabinet-apply">
            {t('cabinet.apply')}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <svg
          viewBox={`-60 -60 ${size.w + 120} ${size.h + 120}`}
          className="max-h-[60vh] w-full rounded bg-bg"
          role="img"
          aria-label={t('cabinet.preview')}
        >
          <rect
            x={0}
            y={0}
            width={size.w}
            height={size.h - PL}
            fill="#e9e3d8"
            stroke="#555"
            strokeWidth={8}
          />
          <rect x={10} y={size.h - PL} width={size.w - 20} height={PL} fill="#444" />
          {svgCells.map((s) => (
            <g key={`${s.ci}-${s.ri}`}>
              <rect
                x={s.x + 3}
                y={s.y + 3}
                width={s.w - 6}
                height={s.h - 6}
                fill={s.c === 'o' || s.c === 'h' ? '#8a8378' : '#f4efe6'}
                stroke="#666"
                strokeWidth={4}
              />
              {s.c === 'h' && (
                <line
                  x1={s.x + 20}
                  x2={s.x + s.w - 20}
                  y1={s.y + 90}
                  y2={s.y + 90}
                  stroke="#333"
                  strokeWidth={14}
                />
              )}
              {(s.c === 'd' || s.c === 'dr') && handle !== 'none' && (
                <rect
                  x={s.c === 'd' ? (s.ci % 2 ? s.x + 40 : s.x + s.w - 52) : s.x + s.w / 2 - 80}
                  y={s.c === 'd' ? s.y + s.h / 2 - 100 : s.y + s.h / 2 - 6}
                  width={s.c === 'd' ? 12 : 160}
                  height={s.c === 'd' ? 200 : 12}
                  fill="#333"
                />
              )}
            </g>
          ))}
          <text
            x={size.w / 2}
            y={size.h + 50}
            fontSize={60}
            textAnchor="middle"
            fill="currentColor"
          >{`${size.w}`}</text>
          <text
            x={-30}
            y={size.h / 2}
            fontSize={60}
            textAnchor="middle"
            fill="currentColor"
            transform={`rotate(-90 -30 ${size.h / 2})`}
          >{`${size.h}`}</text>
        </svg>
        <div className="space-y-3 text-xs">
          {(['w', 'h', 'd'] as const).map((k) => (
            <label key={k} className="block">
              <span className="flex justify-between">
                <span>{t(`cabinet.${k}`)}</span>
                <span className="font-mono">{`${size[k]} mm`}</span>
              </span>
              <input
                className="hud-range w-full"
                type="range"
                min={range(k)[0]}
                max={range(k)[1]}
                step={10}
                value={size[k]}
                disabled={!spec[k]}
                onChange={(e) => setSize({ ...size, [k]: Number(e.target.value) })}
                data-testid={`cabinet-${k}`}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-1">
            {Object.keys(PRESETS).map((k) => (
              <button
                key={k}
                className="hud-chip"
                onClick={() => setCols(parseCabinetLayout(PRESETS[k]!) as Cell[][])}
              >
                {t(`cabinet.presets.${k}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span>{t('cabinet.columns', { n: cols.length })}</span>
            <button
              className="icon-btn"
              aria-label={t('cabinet.removeCol')}
              disabled={cols.length <= 1}
              onClick={() => setCols(cols.slice(0, -1))}
            >
              <Minus size={12} aria-hidden />
            </button>
            <button
              className="icon-btn"
              aria-label={t('cabinet.addCol')}
              disabled={cols.length >= 8}
              onClick={() => setCols([...cols, ['d']])}
              data-testid="cabinet-add-col"
            >
              <Plus size={12} aria-hidden />
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {cols.map((rows, ci) => (
              <div key={ci} className="hud-section p-2">
                <p className="mb-1 text-muted">{t('cabinet.column', { n: ci + 1 })}</p>
                {rows.map((c, ri) => (
                  <div key={ri} className="mb-1 flex gap-1">
                    <select
                      className="field flex-1"
                      value={c}
                      onChange={(e) => setCell(ci, ri, e.target.value as Cell)}
                      data-testid={`cabinet-cell-${ci}-${ri}`}
                    >
                      {CELLS.map((x) => (
                        <option key={x} value={x}>
                          {t(`cabinet.cells.${x}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      aria-label={t('cabinet.removeRow')}
                      disabled={rows.length <= 1}
                      onClick={() =>
                        setCols(cols.map((col, i) => (i === ci ? col.filter((_, j) => j !== ri) : col)))
                      }
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                ))}
                <button
                  className="btn w-full justify-center"
                  disabled={rows.length >= 8}
                  onClick={() => setCols(cols.map((col, i) => (i === ci ? [...col, 'o'] : col)))}
                >
                  <Plus size={12} aria-hidden /> {t('cabinet.addRow')}
                </button>
              </div>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block">{t('cabinet.handle')}</span>
            <select
              className="field w-full"
              value={handle}
              onChange={(e) => setHandle(e.target.value as (typeof HANDLES)[number])}
            >
              {HANDLES.map((h) => (
                <option key={h} value={h}>
                  {t(`cabinet.handles.${h}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </HudDialog>
  );
}

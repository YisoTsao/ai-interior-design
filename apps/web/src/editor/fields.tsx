import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Palette, RotateCcw } from 'lucide-react';
import { COLOR_FAMILIES, pushRecentColor, recentColors, searchColors } from './colorCards';
import { formatLength, parseLength, type LengthUnit } from '@interiorai/editor-2d';

/** 長度欄位：依偏好單位顯示；Enter 提交成一個 Command（02 §4） */
export function LengthField({
  label,
  mm,
  unit,
  onCommit,
  testId,
}: {
  label: string;
  mm: number;
  unit: LengthUnit;
  onCommit: (mm: number) => void;
  testId?: string;
}) {
  const id = useId();
  const shown = formatLength(mm, unit).replace(/\s*(mm|cm|m)$/, '');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          className="field w-full"
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(shown)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = parseLength(text, unit);
              if (v !== null) onCommit(v);
              else setText(shown);
            } else if (e.key === 'Escape') setText(shown);
          }}
        />
        <span className="text-muted">{unit}</span>
      </span>
    </label>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  suffix?: string;
  testId?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          className="field w-full"
          inputMode="decimal"
          step={step}
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(String(value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = Number(text);
              if (Number.isFinite(v)) onCommit(v);
              else setText(String(value));
            }
          }}
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <select
        id={id}
        className="field w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * 滑桿＋數值輸入（ADR-023）：拖曳中只更新本地顯示，放開（或 Enter）才提交成一個 Command，
 * 避免一次拖曳塞滿復原歷史。format 決定顯示的小數位。
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onCommit,
  onReset,
  kelvin,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (v: number) => void;
  /** 有覆寫值時顯示「恢復預設」 */
  onReset?: () => void;
  /** 色溫滑桿（暖→冷漸層） */
  kelvin?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [v, setV] = useState(value);
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setV(value);
    setText(String(value));
  }, [value]);
  const decimals = step < 1 ? Math.min(3, String(step).split('.')[1]?.length ?? 2) : 0;
  const fmt = (n: number) => (decimals ? n.toFixed(decimals) : String(Math.round(n)));
  const commit = (n: number) => {
    const c = Math.min(max, Math.max(min, n));
    if (Math.abs(c - value) > 1e-9) onCommit(Number(fmt(c)));
    else setText(fmt(value));
  };
  const fill = `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="grid gap-0.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <span className="flex items-center gap-1">
          {onReset && (
            <button
              type="button"
              className="text-muted hover:text-fg"
              aria-label={t('inspector.reset')}
              title={t('inspector.reset')}
              onClick={onReset}
            >
              <RotateCcw size={11} aria-hidden />
            </button>
          )}
          <input
            className="field w-16 py-0 text-right"
            aria-label={label}
            inputMode="decimal"
            value={text}
            data-testid={testId ? `${testId}-input` : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setText(fmt(value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(text);
                if (Number.isFinite(n)) commit(n);
                else setText(fmt(value));
              }
            }}
          />
          {suffix && <span className="w-6 text-muted">{suffix}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className={`hud-range ${kelvin ? 'kelvin' : ''}`}
        style={{ ['--fill' as string]: fill }}
        min={min}
        max={max}
        step={step}
        value={v}
        data-testid={testId}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          setText(fmt(n));
        }}
        onPointerUp={() => commit(v)}
        onKeyUp={(e) =>
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(
            e.key,
          ) && commit(v)
        }
      />
    </div>
  );
}

/** 顏色覆寫：原生取色器（放開時提交）＋恢復預設 */
export function ColorField({
  label,
  value,
  fallback,
  onCommit,
  onReset,
  testId,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onCommit: (hex: string) => void;
  onReset?: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [v, setV] = useState(value ?? fallback);
  useEffect(() => setV(value ?? fallback), [value, fallback]);
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <label htmlFor={id}>{label}</label>
      <span className="flex items-center gap-1.5">
        {value && onReset && (
          <button
            type="button"
            className="text-muted hover:text-fg"
            aria-label={t('inspector.reset')}
            title={t('inspector.reset')}
            onClick={onReset}
          >
            <RotateCcw size={11} aria-hidden />
          </button>
        )}
        <span className="font-mono text-[10px] text-muted">{v.toUpperCase()}</span>
        <ColorCardsButton
          onPick={(hex) => {
            setV(hex);
            onCommit(hex);
          }}
        />
        <input
          id={id}
          type="color"
          className="h-6 w-9 cursor-pointer border border-border bg-transparent p-0"
          value={v}
          data-testid={testId}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== (value ?? fallback) && (pushRecentColor(v), onCommit(v))}
          onPointerLeave={() => v !== (value ?? fallback) && (pushRecentColor(v), onCommit(v))}
        />
      </span>
    </div>
  );
}

/** 開關（role=switch） */
export function ToggleField({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="hud-switch"
        data-testid={testId}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** 可收合的屬性分節 */
export function Section({
  title,
  children,
  defaultOpen = true,
  right,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  testId?: string;
}) {
  return (
    <details className="hud-section" open={defaultOpen} data-testid={testId}>
      <summary className="flex items-center justify-between gap-2">
        <span className="hud-title flex-1">{title}</span>
        {right}
        <ChevronRight size={14} className="chev text-muted" aria-hidden />
      </summary>
      <div className="hud-section-body">{children}</div>
    </details>
  );
}

/** 色卡彈出面板（FE-FIN-05）：搜尋色號／名稱、分色系、最近用色 */
function ColorCardsButton({ onPick }: { onPick: (hex: string) => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [fam, setFam] = useState<(typeof COLOR_FAMILIES)[number] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  }, [open]);
  const list = searchColors(q).filter((c) => !fam || c.family === fam);
  const pick = (hex: string) => {
    pushRecentColor(hex);
    onPick(hex);
    setOpen(false);
  };
  const recent = open ? recentColors() : [];
  return (
    <span className="relative" ref={ref}>
      <button
        type="button"
        className="text-muted hover:text-primary"
        aria-label={t('colors.open')}
        title={t('colors.open')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="color-cards"
      >
        <Palette size={13} aria-hidden />
      </button>
      {open && (
        <div
          className="hud-popover absolute top-6 right-0 z-50 w-72 space-y-2 p-2"
          data-testid="color-cards-panel"
        >
          <input
            autoFocus
            className="field w-full"
            placeholder={t('colors.search')}
            aria-label={t('colors.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {COLOR_FAMILIES.map((f) => (
              <button
                key={f}
                type="button"
                className="hud-chip text-[10px]"
                aria-pressed={fam === f}
                onClick={() => setFam(fam === f ? null : f)}
              >
                {t(`colors.families.${f}`)}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label={t('colors.recent')}>
              {recent.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="h-5 w-5 rounded border border-border"
                  style={{ background: h }}
                  title={h}
                  onClick={() => pick(h)}
                />
              ))}
            </div>
          )}
          <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
            {list.map((c) => {
              const nm = i18n.language === 'en' ? c.en : c.zh;
              return (
                <button
                  key={c.code}
                  type="button"
                  className="h-8 rounded border border-border"
                  style={{ background: c.hex }}
                  title={`${nm} · NCS ${c.code}`}
                  aria-label={`${nm} NCS ${c.code}`}
                  onClick={() => pick(c.hex)}
                  data-testid={`color-${c.code.replace(/\s/g, '')}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

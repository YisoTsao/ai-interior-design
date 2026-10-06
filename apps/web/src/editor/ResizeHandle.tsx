import { useTranslation } from 'react-i18next';

/**
 * 面板調寬（FE-UX-07）：拖曳邊界改變寬度（寬度存在 CSS 變數與本機偏好）；雙擊還原預設。
 * side＝left：拖曳右緣；right：拖曳左緣。
 */
export function ResizeHandle({
  side,
  width,
  onChange,
  min = 240,
  max = 560,
  def,
}: {
  side: 'left' | 'right';
  width: number;
  onChange: (w: number) => void;
  min?: number;
  max?: number;
  def: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(side === 'left' ? 'top.resizeLeft' : 'top.resizeRight')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/60 focus-visible:bg-primary"
      data-testid={`resize-${side}`}
      onDoubleClick={() => onChange(def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === 'ArrowLeft')
          onChange(Math.max(min, Math.min(max, width + (side === 'left' ? -step : step))));
        if (e.key === 'ArrowRight')
          onChange(Math.max(min, Math.min(max, width + (side === 'left' ? step : -step))));
      }}
      onPointerDown={(e) => {
        const x0 = e.clientX;
        const w0 = width;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0;
          onChange(Math.max(min, Math.min(max, Math.round(w0 + (side === 'left' ? dx : -dx)))));
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    />
  );
}

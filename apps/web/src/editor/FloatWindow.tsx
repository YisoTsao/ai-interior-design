import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { usePrefs } from '../prefs';

/**
 * 浮動面板（FE-UX-07）：把左側工具／右側屬性面板拆成可拖曳的視窗，浮在畫布上；
 * 位置存在本機偏好，「停靠」放回側邊。視窗不會被拖出畫布範圍。
 */
export function FloatWindow({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const { t } = useTranslation();
  const pos = usePrefs((s) => s.panelFloat[side === 'left' ? 'leftPos' : 'rightPos']);
  const setFloat = usePrefs((s) => s.setPanelFloat);
  const box = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px: pos[0], py: pos[1] };
    const move = (ev: PointerEvent) => {
      const maxX = parent.clientWidth - 120;
      const maxY = parent.clientHeight - 40;
      const nx = Math.max(0, Math.min(maxX, start.px + ev.clientX - start.x));
      const ny = Math.max(0, Math.min(maxY, start.py + ev.clientY - start.y));
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const nx = Math.max(0, start.px + ev.clientX - start.x);
      const ny = Math.max(0, start.py + ev.clientY - start.y);
      setFloat(
        side === 'left'
          ? { leftPos: [Math.round(nx), Math.round(ny)] }
          : { rightPos: [Math.round(nx), Math.round(ny)] },
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const Dock = side === 'left' ? PanelLeftClose : PanelRightClose;
  return (
    <div
      ref={box}
      className="hud-float absolute z-20 flex max-h-[calc(100%-16px)] flex-col shadow-2xl"
      style={{ left: pos[0], top: pos[1] }}
      data-testid={`float-${side}`}
    >
      <div
        className="hud-bar flex h-7 shrink-0 cursor-move items-center gap-2 px-2 text-[11px] select-none"
        onPointerDown={onDown}
        role="toolbar"
        aria-label={t('float.handle')}
      >
        <span className="hud-title flex-1">{t(side === 'left' ? 'tools.title' : 'inspector.title')}</span>
        <button
          className="icon-btn h-6 w-6"
          aria-label={t('float.dock')}
          title={t('float.dock')}
          onClick={() => setFloat(side === 'left' ? { left: false } : { right: false })}
          data-testid={`dock-${side}`}
        >
          <Dock size={13} aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

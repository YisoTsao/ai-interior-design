import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vec2 } from '@interiorai/core-geometry';
import type { EditActions } from './actions';

export interface MenuState {
  x: number;
  y: number;
  world: Vec2 | null;
}

/** 右鍵選單（FE-PLAN-14、FE-UX-05）：2D、3D、物件清單共用；遊戲 HUD 風格 */
export function ContextMenu({
  state,
  actions,
  onClose,
  onArray,
}: {
  state: MenuState;
  actions: EditActions;
  onClose: () => void;
  onArray: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const c = actions.counts();
  useEffect(() => {
    const off = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('pointerdown', off, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const item = (key: string, run: () => void, enabled = true, hint?: string) => (
    <button
      key={key}
      role="menuitem"
      disabled={!enabled}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs hover:bg-primary hover:text-primary-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg"
      onClick={() => {
        run();
        onClose();
      }}
      data-testid={`ctx-${key}`}
    >
      <span>{t(`ctx.${key}`)}</span>
      {hint && <span className="font-mono text-[10px] opacity-60">{hint}</span>}
    </button>
  );
  const sep = (k: string) => <div key={k} className="my-1 h-px bg-border" />;
  // 依實際高度夾在視窗內
  const [pos, setPos] = useState({ left: state.x, top: state.y });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 400;
    setPos({
      left: Math.max(8, Math.min(state.x, window.innerWidth - 232)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - h - 8)),
    });
  }, [state.x, state.y]);
  const { left, top } = pos;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('ctx.title')}
      className="hud-popover fixed z-50 w-56 py-1"
      style={{ left, top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {item('cut', actions.cut, c.any > 0, '⌘X')}
      {item('copy', actions.copy, c.any > 0, '⌘C')}
      {item('paste', () => actions.paste(state.world ?? undefined), c.clip, '⌘V')}
      {item('duplicate', actions.duplicate, c.objects > 0, '⌘D')}
      {item('delete', actions.del, c.any > 0, 'Del')}
      {sep('s1')}
      {item('rotate90', () => actions.rotate(90), c.objects > 0, 'E')}
      {item('mirrorX', () => actions.mirror('x'), c.objects > 0)}
      {item('mirrorZ', () => actions.mirror('z'), c.objects > 0)}
      {item('array', onArray, c.objects > 0)}
      {sep('s2')}
      {item('group', actions.group, c.objects > 1, '⌘G')}
      {item('ungroup', actions.ungroup, !!c.grouped, '⇧⌘G')}
      {item('alignLeft', () => actions.align('left'), c.objects > 1)}
      {item('alignCenterX', () => actions.align('centerX'), c.objects > 1)}
      {item('alignTop', () => actions.align('top'), c.objects > 1)}
      {item('distributeX', () => actions.distribute('x'), c.objects > 2)}
      {item('distributeZ', () => actions.distribute('z'), c.objects > 2)}
      {sep('s3')}
      {item('lock', actions.toggleLock, c.objects > 0, 'L')}
      {item('hide', actions.toggleHide, c.objects > 0, 'H')}
      {item('selectSame', actions.selectSame, c.any > 0)}
      {item('selectAll', actions.selectAll, true, '⌘A')}
    </div>
  );
}

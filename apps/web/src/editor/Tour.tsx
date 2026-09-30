import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const KEY = 'tour.done.v1';
export const STEPS = ['welcome', 'tools', 'assets', 'view', 'inspector', 'ai', 'output'] as const;
type Step = (typeof STEPS)[number];
const TARGET: Partial<Record<Step, string>> = {
  tools: '[data-tour=tools]',
  assets: '[data-tour=assets]',
  view: '[data-tour=view]',
  inspector: '[data-tour=inspector]',
  ai: '[data-tour=ai]',
  output: '[data-tour=output]',
};

export const tourDone = () => {
  try {
    return localStorage.getItem(KEY) === '1' || navigator.webdriver;
  } catch {
    return true;
  }
};
const markDone = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* 私密模式 */
  }
};

/**
 * 新手導覽（FE-UX-01）：首次進入編輯器自動開始；聚光燈標示畫面區塊（工具列→資產庫→視圖→屬性→AI→輸出），
 * 可略過、上一步／下一步；之後從「？」按鈕重看。自動化測試（navigator.webdriver）不顯示。
 */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i]!;
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const sel = TARGET[step];
    const measure = () =>
      setRect(sel ? (document.querySelector(sel)?.getBoundingClientRect() ?? null) : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, step]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  if (!open) return null;
  const finish = () => {
    markDone();
    onClose();
  };
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : finish());
  const pad = 6;
  // 說明卡片：目標右側（空間不足則左側／下方）；沒有目標置中
  const W = 320;
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right + W + 24 < vw)
      cardStyle = { left: rect.right + 16, top: Math.min(vh - 220, Math.max(16, rect.top)) };
    else if (rect.left - W - 24 > 0)
      cardStyle = { left: rect.left - W - 16, top: Math.min(vh - 220, Math.max(16, rect.top)) };
    else
      cardStyle = {
        left: Math.max(16, Math.min(vw - W - 16, rect.left)),
        top: Math.min(vh - 220, rect.bottom + 16),
      };
  }
  return (
    <div
      className="game-ui fixed inset-0 z-[60]"
      style={{ background: 'transparent' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="tour"
    >
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg border-2 border-primary transition-all duration-200"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.6), 0 0 24px var(--primary)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/60" />
      )}
      <div className="hud-panel fixed space-y-3 p-4" style={{ width: W, ...cardStyle }}>
        <p className="text-[11px] text-muted">{`${i + 1} / ${STEPS.length}`}</p>
        <h2 id="tour-title" className="hud-title text-base">
          {t(`tour.${step}.title`)}
        </h2>
        <p className="text-sm">{t(`tour.${step}.body`)}</p>
        <div className="flex gap-2">
          <button className="btn" onClick={finish} data-testid="tour-skip">
            {t('tour.skip')}
          </button>
          <span className="flex-1" />
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              {t('tour.prev')}
            </button>
          )}
          <button className="btn btn-primary" onClick={next} data-testid="tour-next" autoFocus>
            {i === STEPS.length - 1 ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/** 復原歷史（FE-UX-04）：點任一步驟跳回（多次 undo／redo），未來的步驟以淡色顯示 */
export function HistoryPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const past = useEditor((s) => s.history.past);
  const future = useEditor((s) => s.history.future);
  // future[0] 為最近被復原的一步（redo 先取它）→ 時間順序＝past…、future[0]、future[1]…
  const rows = [
    { label: 'history.start', at: -past.length, cur: past.length === 0 },
    ...past.map((e, k) => ({ label: e.label, at: k + 1 - past.length, cur: k === past.length - 1 })),
    ...future.map((e, k) => ({ label: e.label, at: k + 1, cur: false, redo: true })),
  ];
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <History size={16} aria-hidden /> {t('history.title')}
        </span>
      }
      side="right"
      width={320}
      testId="history-panel"
    >
      <ol className="space-y-0.5 text-sm" data-testid="history-list">
        {rows.map((r, k) => (
          <li key={k}>
            <button
              className={`w-full rounded px-2 py-1 text-left ${r.cur ? 'bg-primary/20 font-bold text-primary' : ''} ${
                'redo' in r ? 'text-muted italic' : ''
              }`}
              aria-current={r.cur ? 'step' : undefined}
              onClick={() => store.getState().jump(r.at)}
              data-testid="history-step"
            >
              {`${k}. `}
              {t(r.label)}
            </button>
          </li>
        ))}
      </ol>
    </HudDialog>
  );
}

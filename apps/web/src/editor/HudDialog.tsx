import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * 遊戲風格的對話框外殼：center＝置中視窗；right＝右側抽屜（面板類，例如助理、報價）。
 * 內容自行排版；標題列含關閉鈕。
 */
export function HudDialog({
  open,
  onOpenChange,
  title,
  testId,
  side = 'center',
  width = 640,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  testId?: string;
  side?: 'center' | 'right';
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`fixed inset-0 z-40 ${side === 'right' ? 'bg-black/20' : 'bg-black/60'}`}
        />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid={testId}
          style={{ width: `min(${width}px, 100vw)` }}
          className={
            side === 'right'
              ? 'game-ui hud-panel fixed top-0 right-0 z-50 flex h-full flex-col gap-3 p-4'
              : 'game-ui hud-panel fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5'
          }
        >
          <div className="flex items-center gap-2">
            <Dialog.Title className="hud-title flex-1 text-base">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={t('common.close')}>
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

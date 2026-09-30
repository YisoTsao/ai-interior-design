import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { FileUp, X } from 'lucide-react';
import { PlanParseError } from '@interiorai/plan-recognition';
import { recognizePlanFile } from './local';

/**
 * 匯入平面圖（FR-101/102）：選檔或拖放 → 瀏覽器辨識（或 cv-service）→ 校正頁 → 建立 2D/3D 專案。
 * 不需要登入，也不需要後端。
 */
export function ImportPlanButton({ className = 'btn' }: { className?: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const run = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await recognizePlanFile(file);
      void nav(`/import/${s.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(
        e instanceof PlanParseError
          ? msg === 'TOO_LARGE'
            ? t('planImport.tooLarge')
            : e.code === 'UPLOAD_REJECTED'
              ? msg
              : t('planImport.parseFailed', { message: msg })
          : t('planImport.parseFailed', { message: msg }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className={className} data-testid="import-plan">
          <FileUp size={16} aria-hidden /> {t('planImport.button')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="game-ui hud-panel fixed top-24 left-1/2 z-50 w-[480px] max-w-[calc(100%-32px)] -translate-x-1/2 space-y-3 p-5"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="hud-title flex-1 text-base">{t('planImport.title')}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={t('render.close')}>
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <p className="text-xs text-muted">{t('planImport.formats')}</p>
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 border border-dashed p-8 text-center text-sm ${over ? 'border-primary bg-primary/10' : 'border-border'}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void run(e.dataTransfer.files[0]);
            }}
          >
            <FileUp size={26} aria-hidden className="text-primary" />
            <span>{busy ? t('planImport.analyzing') : t('planImport.choose')}</span>
            <input
              type="file"
              accept=".dxf,.png,.jpg,.jpeg,.webp"
              className="sr-only"
              disabled={busy}
              aria-label={t('planImport.choose')}
              data-testid="import-file"
              onChange={(e) => void run(e.target.files?.[0])}
            />
          </label>
          {busy && (
            <p aria-live="polite" className="text-xs text-muted" data-testid="plan-progress">
              {t('planImport.analyzing')}
            </p>
          )}
          {err && (
            <p role="alert" className="text-sm text-danger" data-testid="plan-failed">
              {err}
            </p>
          )}
          <p className="text-[11px] text-muted">{t('planImport.privacy')}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

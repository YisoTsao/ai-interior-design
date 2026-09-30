import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { FileUp, X } from 'lucide-react';
import { ApiClientError, api, refresh, useAuth } from '../../cloud/client';
import { AuthForm } from '../../cloud/AuthForm';

const MIME: Record<string, string> = {
  dxf: 'application/dxf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** 匯入平面圖（FR-101/102）：上傳 → 建立辨識任務 → 前往校正頁 */
export function ImportPlanButton() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && auth.status === 'unknown') void refresh();
  }, [open, auth.status]);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const ext = file.name.toLowerCase().split('.').pop() ?? '';
      const mime = MIME[ext];
      if (!mime) throw new Error(t('planImport.badType'));
      const tk = await api.post('/uploads', {
        body: { kind: 'plan', filename: file.name, mime, sizeBytes: file.size },
      });
      const put = await fetch(tk.putUrl, { method: 'PUT', headers: tk.headers, body: file });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      await api.post('/uploads/{id}/complete', { params: { id: tk.upload.id } });
      const job = await api.post('/plan-imports', {
        idempotencyKey: crypto.randomUUID(),
        body: { uploadId: tk.upload.id },
      });
      void nav(`/import/${job.id}`);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? t(`render.err.${e.code}`, { defaultValue: e.message })
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="btn" data-testid="import-plan">
          <FileUp size={16} aria-hidden /> {t('planImport.button')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20" />
        <Dialog.Content
          className="fixed left-1/2 top-24 w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xl"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-semibold">{t('planImport.title')}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={t('render.close')}>
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          {auth.status !== 'authenticated' ? (
            <AuthForm hint={t('planImport.loginHint')} />
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted">{t('planImport.formats')}</p>
              <input
                ref={input}
                type="file"
                accept=".dxf,.png,.jpg,.jpeg,.webp"
                className="block w-full text-sm"
                disabled={busy}
                aria-label={t('planImport.choose')}
                data-testid="import-file"
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
              {busy && <p aria-live="polite">{t('planImport.uploading')}</p>}
              {err && (
                <p role="alert" className="text-danger">
                  {err}
                </p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

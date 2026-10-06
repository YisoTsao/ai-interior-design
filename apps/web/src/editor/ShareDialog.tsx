import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { shareUrl } from '../share';
import { useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/** 分享（FE-SHR-01）：產生唯讀檢視連結（場景壓縮在網址內，不需後端） */
export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const s = store.getState();
    void shareUrl(s.scene, s.projectName).then(setUrl);
  }, [open, store]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* 不支援剪貼簿：使用者可手動複製 */
    }
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title')}
      testId="share-dialog"
      width={560}
    >
      <p className="mb-3 text-xs text-muted">{t('share.desc')}</p>
      <div className="flex gap-2">
        <input
          className="field flex-1 font-mono text-xs"
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label={t('share.link')}
          data-testid="share-url"
        />
        <button className="btn btn-primary" onClick={() => void copy()} disabled={!url}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{' '}
          {copied ? t('share.copied') : t('share.copy')}
        </button>
        <a className="btn" href={url || undefined} target="_blank" rel="noreferrer" aria-disabled={!url}>
          <ExternalLink size={14} aria-hidden /> {t('share.open')}
        </a>
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('share.note', { kb: Math.ceil(url.length / 1024) })}</p>
    </HudDialog>
  );
}

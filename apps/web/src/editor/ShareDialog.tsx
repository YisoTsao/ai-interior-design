import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { addApproval, approvalsOf } from '@interiorai/app-state';
import { listVersions, type VersionRecord } from '../media';
import { decodeApproval, sceneHash, shareUrl } from '../share';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/**
 * 分享（FE-SHR-01）：產生唯讀檢視連結（場景壓縮在網址內，不需後端）。
 * FE-SHR-06：可附上替代方案（已存版本）並要求客戶確認；客戶回傳的確認碼在這裡匯入並驗證方案指紋。
 */
export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const approvals = approvalsOf(useEditor((s) => s.scene));
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [alts, setAlts] = useState<string[]>([]);
  const [askApproval, setAskApproval] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setMsg(null);
    void listVersions(projectId).then(setVersions);
  }, [open, projectId]);
  useEffect(() => {
    if (!open) return;
    const s = store.getState();
    const schemes = versions
      .filter((v) => alts.includes(v.id))
      .map((v) => ({ name: v.name, scene: v.scene }));
    void shareUrl(s.scene, s.projectName, { schemes, approval: askApproval }).then(setUrl);
  }, [open, store, versions, alts, askApproval]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* 不支援剪貼簿：使用者可手動複製 */
    }
  };
  const importCode = async () => {
    try {
      const a = await decodeApproval(code);
      const cur = await sceneHash(store.getState().scene);
      let match: 'current' | 'version' | 'unknown' = a.schemeHash === cur ? 'current' : 'unknown';
      if (match === 'unknown')
        for (const v of versions)
          if ((await sceneHash(v.scene)) === a.schemeHash) {
            match = 'version';
            break;
          }
      store.getState().exec(
        addApproval({
          id: `${a.signedAt}-${a.schemeHash.slice(0, 8)}`,
          scheme: a.scheme,
          schemeHash: a.schemeHash,
          client: a.client,
          note: a.note,
          signedAt: a.signedAt,
          signature: a.signature,
          match,
        }),
      );
      setMsg({
        ok: match !== 'unknown',
        text: t(`approval.match.${match}`, { client: a.client, scheme: a.scheme }),
      });
      setCode('');
    } catch {
      setMsg({ ok: false, text: t('approval.badCode') });
    }
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title')}
      testId="share-dialog"
      width={600}
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
      <details className="hud-section mt-3" open={versions.length > 0}>
        <summary className="hud-title">{t('approval.shareSection')}</summary>
        <div className="hud-section-body text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={askApproval}
              onChange={(e) => setAskApproval(e.target.checked)}
              data-testid="share-ask-approval"
            />
            {t('approval.ask')}
          </label>
          {versions.length === 0 ? (
            <p className="text-muted">{t('approval.noVersions')}</p>
          ) : (
            <fieldset className="space-y-1">
              <legend className="text-muted">{t('approval.alternatives')}</legend>
              {versions.map((v) => (
                <label key={v.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={alts.includes(v.id)}
                    onChange={(e) =>
                      setAlts(e.target.checked ? [...alts, v.id] : alts.filter((x) => x !== v.id))
                    }
                    data-testid={`share-alt-${v.id}`}
                  />
                  {v.name} · {new Date(v.at).toLocaleString()}
                </label>
              ))}
            </fieldset>
          )}
          <label className="grid gap-1">
            <span>{t('approval.import')}</span>
            <div className="flex gap-1">
              <input
                className="field min-w-0 flex-1 font-mono text-[11px]"
                value={code}
                placeholder="IAI-OK-…"
                onChange={(e) => setCode(e.target.value)}
                data-testid="approval-import"
              />
              <button
                className="btn px-2"
                disabled={!code.trim()}
                onClick={() => void importCode()}
                data-testid="approval-import-ok"
              >
                {t('approval.verify')}
              </button>
            </div>
          </label>
          {msg && (
            <p className={msg.ok ? 'text-ok' : 'text-warn'} role="status" data-testid="approval-msg">
              {msg.text}
            </p>
          )}
          {approvals.length > 0 && (
            <ul className="space-y-1" data-testid="approval-list">
              {approvals.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <img
                    src={a.signature}
                    alt={t('approval.signature')}
                    className="h-8 w-20 border border-border bg-white"
                  />
                  <span>
                    <b>{a.client}</b> · {a.scheme} · {new Date(a.signedAt).toLocaleString()}
                    <br />
                    <span className={a.match === 'unknown' ? 'text-warn' : 'text-ok'}>
                      {t(`approval.matchShort.${a.match}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </HudDialog>
  );
}

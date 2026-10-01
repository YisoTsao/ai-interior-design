import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Eraser } from 'lucide-react';
import type { Scene } from '@interiorai/scene-schema';
import { HudDialog } from '../editor/HudDialog';
import { download } from '../media';
import { encodeApproval, sceneHash } from '../share';

/**
 * 客戶確認（FE-SHR-06，分享頁）：選定的方案＋姓名＋手寫簽名＋同意條款 →
 * 產生「確認碼」（傳回給設計師匯入，含方案指紋）與確認單 PNG（自行保存）。不經伺服器。
 */
export function ApprovalDialog({
  open,
  onOpenChange,
  project,
  scheme,
  scene,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: string;
  scheme: string;
  scene: Scene;
}) {
  const { t } = useTranslation();
  const pad = useRef<HTMLCanvasElement>(null);
  const [client, setClient] = useState('');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [signed, setSigned] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return;
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const g = c.getContext('2d')!;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.strokeStyle = '#111';
    const last = (c as unknown as { _last?: [number, number] })._last;
    g.beginPath();
    if (last && e.type === 'pointermove') g.moveTo(last[0], last[1]);
    else g.moveTo(x, y);
    g.lineTo(x, y);
    g.stroke();
    (c as unknown as { _last?: [number, number] })._last = [x, y];
    setSigned(true);
  };
  const clear = () => {
    const c = pad.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };
  const confirm = async () => {
    const c = pad.current;
    if (!c) return;
    const signature = c.toDataURL('image/png');
    const signedAt = new Date().toISOString();
    const schemeHash = await sceneHash(scene);
    setCode(
      await encodeApproval({
        project,
        scheme,
        schemeHash,
        client: client.trim(),
        note: note.trim() || undefined,
        signedAt,
        signature,
      }),
    );
    // 確認單：文字＋簽名合成一張 PNG
    const out = document.createElement('canvas');
    out.width = 900;
    out.height = 560;
    const g = out.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = '#111';
    g.font = 'bold 30px sans-serif';
    g.fillText(t('approval.sheetTitle'), 40, 64);
    g.font = '20px sans-serif';
    const rows = [
      `${t('approval.project')}：${project}`,
      `${t('approval.scheme')}：${scheme}`,
      `${t('approval.client')}：${client.trim()}`,
      `${t('approval.time')}：${new Date(signedAt).toLocaleString()}`,
      `${t('approval.fingerprint')}：${schemeHash.slice(0, 16)}`,
      ...(note.trim() ? [`${t('approval.note')}：${note.trim()}`] : []),
    ];
    rows.forEach((r, i) => g.fillText(r, 40, 120 + i * 34));
    g.strokeStyle = '#999';
    g.strokeRect(40, 340, 420, 170);
    g.drawImage(c, 40, 340, 420, 170);
    g.font = '14px sans-serif';
    g.fillText(t('approval.signature'), 40, 530);
    setSheet(out.toDataURL('image/png'));
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('approval.title')}
      testId="approval-dialog"
      width={560}
    >
      {!code ? (
        <div className="space-y-2 text-xs">
          <p>
            {t('approval.schemeLabel')} <b data-testid="approval-scheme">{scheme}</b>
          </p>
          <label className="grid gap-1">
            <span>{t('approval.client')}</span>
            <input
              className="field"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              data-testid="approval-name"
            />
          </label>
          <label className="grid gap-1">
            <span>{t('approval.note')}</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span>{t('approval.signature')}</span>
              <button className="icon-btn h-6 w-6" aria-label={t('approval.clear')} onClick={clear}>
                <Eraser size={12} aria-hidden />
              </button>
            </div>
            <canvas
              ref={pad}
              width={420}
              height={170}
              className="w-full touch-none rounded border border-border bg-white"
              onPointerDown={(e) => {
                (e.currentTarget as unknown as { _last?: unknown })._last = undefined;
                draw(e);
              }}
              onPointerMove={draw}
              aria-label={t('approval.signHere')}
              data-testid="approval-pad"
            />
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              data-testid="approval-agree"
            />
            <span>{t('approval.agree')}</span>
          </label>
          <button
            className="btn btn-primary w-full justify-center"
            disabled={!client.trim() || !signed || !agree}
            onClick={() => void confirm()}
            data-testid="approval-submit"
          >
            {t('approval.submit')}
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-xs" data-testid="approval-done">
          <p>{t('approval.done')}</p>
          <textarea
            className="field h-20 w-full font-mono text-[10px]"
            readOnly
            value={code}
            data-testid="approval-code"
          />
          <div className="flex gap-2">
            <button
              className="btn flex-1 justify-center"
              onClick={() => void navigator.clipboard?.writeText(code)}
            >
              <Copy size={14} aria-hidden /> {t('approval.copy')}
            </button>
            {sheet && (
              <button
                className="btn flex-1 justify-center"
                onClick={() => download(sheet, `${project}-approval.png`)}
              >
                <Download size={14} aria-hidden /> {t('approval.download')}
              </button>
            )}
          </div>
          {sheet && (
            <img src={sheet} alt={t('approval.sheetTitle')} className="w-full border border-border" />
          )}
        </div>
      )}
    </HudDialog>
  );
}

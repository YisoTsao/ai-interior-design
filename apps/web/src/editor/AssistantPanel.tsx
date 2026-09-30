import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bot, Check, Send, X } from 'lucide-react';
import {
  makeCtx,
  mockTransport,
  proposalCommand,
  runTurn,
  type Change,
  type ChatMessage,
  type ChatTransport,
  type Proposal,
} from '@interiorai/assistant';
import { activeLevel } from '@interiorai/app-state';
import { api } from '../cloud/client';
import { catalog, materials } from '../catalogData';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/**
 * 傳輸層：預設為瀏覽器內的規則式 mock（不需要後端與金鑰）；VITE_ASSISTANT=api 時改走 POST /assistant/chat，
 * 失敗（離線）則退回 mock。
 */
const USE_API = (import.meta.env.VITE_ASSISTANT as string | undefined) === 'api';
const transport: ChatTransport = async (req) => {
  if (!USE_API) return mockTransport(req);
  try {
    return (await api.post('/assistant/chat', { body: req as never })) as Awaited<ReturnType<ChatTransport>>;
  } catch {
    return mockTransport(req);
  }
};

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  proposals?: (Proposal & { state: 'pending' | 'applied' | 'dismissed' })[];
  rejected?: string[];
}

/**
 * 對話助理（FE-AI-03）：自然語言 → 查詢（直接回答）或變更提案（顯示差異，使用者確認後才套用；一個提案＝一次 Undo）。
 */
export function AssistantPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const level = useEditor(activeLevel);
  const [log, setLog] = useState<Entry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 新版 Chrome 的 scrollIntoView 回傳 Promise → 不可作為 effect 的回傳值
    void end.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  const room = level.rooms.find((r) => r.label)?.label ?? t('assistant.defaultRoom');
  const chips = useMemo(
    () => [
      t('assistant.chip.list', { room }),
      t('assistant.chip.budget', { room }),
      t('assistant.chip.clearance', { room }),
      t('assistant.chip.add', { room }),
    ],
    [t, room],
  );

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText('');
    setLog((l) => [...l, { role: 'user', text: m }]);
    setBusy(true);
    try {
      const s = store.getState();
      const ctx = makeCtx(s.scene, s.levelId, catalog, materials);
      const r = await runTurn(ctx, history, m, transport);
      setHistory(r.messages);
      setLog((l) => [
        ...l,
        {
          role: 'assistant',
          text: r.reply,
          proposals: r.proposals.map((p) => ({ ...p, state: 'pending' as const })),
          rejected: r.rejected.map((x) => `${x.name}: ${x.error}`),
        },
      ]);
    } catch (e) {
      setLog((l) => [...l, { role: 'assistant', text: t('assistant.error', { message: String(e) }) }]);
    } finally {
      setBusy(false);
    }
  };
  const setState = (entry: number, id: string, state: 'applied' | 'dismissed') =>
    setLog((l) =>
      l.map((e, i) =>
        i === entry ? { ...e, proposals: e.proposals?.map((p) => (p.id === id ? { ...p, state } : p)) } : e,
      ),
    );
  const apply = (entry: number, p: Proposal) => {
    const s = store.getState();
    if (s.exec(proposalCommand(s.levelId, p))) {
      setState(entry, p.id, 'applied');
      s.notify('info', t('assistant.applied'));
    }
  };

  const describe = (c: Change) => {
    switch (c.kind) {
      case 'move':
        return t('assistant.change.move', { name: c.name, x: c.to.x, z: c.to.z, deg: c.to.rotationDeg });
      case 'resize_wall':
        return t('assistant.change.resize', { name: c.name, from: c.fromMm, to: c.toMm });
      case 'add':
        return t('assistant.change.add', { name: c.name, room: c.roomLabel ?? c.roomId });
      case 'material':
        return t('assistant.change.material', {
          target: c.targetName,
          from: c.fromName ?? '—',
          to: c.toName,
        });
    }
  };

  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <Bot size={16} aria-hidden /> {t('assistant.title')}
        </span>
      }
      side="right"
      width={420}
      testId="assistant-panel"
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex-1 space-y-2 overflow-y-auto" aria-live="polite" data-testid="assistant-log">
          {log.length === 0 && <p className="text-xs text-muted">{t('assistant.intro')}</p>}
          {log.map((e, i) => (
            <div key={i} className={e.role === 'user' ? 'ml-8 text-right' : 'mr-4'}>
              <div
                className={`inline-block rounded-lg px-3 py-2 text-left text-sm whitespace-pre-wrap ${
                  e.role === 'user' ? 'bg-primary/20' : 'bg-surface'
                }`}
                data-role={e.role}
              >
                {e.text}
              </div>
              {e.proposals?.map((p) => (
                <div key={p.id} className="hud-section mt-2 p-2 text-xs" data-testid="assistant-proposal">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {p.changes.map((c, k) => (
                      <li key={k}>{describe(c)}</li>
                    ))}
                  </ul>
                  {p.warnings.map((w, k) => (
                    <p key={k} className="mt-1 flex items-start gap-1 text-warn">
                      <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" /> {w}
                    </p>
                  ))}
                  <div className="mt-2 flex gap-2">
                    {p.state === 'pending' ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => apply(i, p)}
                          data-testid="assistant-apply"
                        >
                          <Check size={14} aria-hidden /> {t('assistant.apply')}
                        </button>
                        <button className="btn" onClick={() => setState(i, p.id, 'dismissed')}>
                          <X size={14} aria-hidden /> {t('assistant.dismiss')}
                        </button>
                      </>
                    ) : (
                      <span className="text-muted">
                        {t(p.state === 'applied' ? 'assistant.stateApplied' : 'assistant.stateDismissed')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {busy && <p className="text-xs text-muted">{t('assistant.thinking')}</p>}
          <div ref={end} />
        </div>
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <button key={c} className="hud-chip" onClick={() => void send(c)} disabled={busy}>
              {c}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            className="field flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('assistant.placeholder')}
            aria-label={t('assistant.placeholder')}
            data-testid="assistant-input"
          />
          <button
            className="btn btn-primary"
            disabled={busy || !text.trim()}
            aria-label={t('assistant.send')}
          >
            <Send size={14} aria-hidden />
          </button>
        </form>
      </div>
    </HudDialog>
  );
}

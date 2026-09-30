import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MapPin, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { commentsOf, deleteComment, replyComment, resolveComment } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

const readName = () => {
  try {
    return localStorage.getItem('displayName') ?? '';
  } catch {
    return '';
  }
};
/** 留言狀態：放置模式（下一次點擊畫布＝釘選）、目前展開的討論串、顯示名稱 */
export const useComments = create<{
  placing: boolean;
  active: string | null;
  name: string;
  set(p: Partial<{ placing: boolean; active: string | null; name: string }>): void;
}>((set) => ({
  placing: false,
  active: null,
  name: readName(),
  set: (p) => {
    if (p.name !== undefined)
      try {
        localStorage.setItem('displayName', p.name);
      } catch {
        /* 私密模式 */
      }
    set(p);
  },
}));

/**
 * 留言標註（FE-SHR-03）：在 2D／3D 點位釘選留言、討論串回覆、標記已解決（可重新開啟）、刪除；
 * 可篩選未解決／全部；點留言跳到該樓層並高亮釘選。
 */
export function CommentsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const all = commentsOf(useEditor((s) => s.scene));
  const view = useEditor((s) => s.view);
  const { placing, active, name, set } = useComments();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [reply, setReply] = useState('');
  const list = all.filter((c) => filter === 'all' || !c.resolved);
  const me = name || t('comments.me');
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <MessageSquare size={16} aria-hidden /> {t('comments.title')}
        </span>
      }
      side="right"
      width={380}
      testId="comments-panel"
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          className="btn btn-primary"
          aria-pressed={placing}
          onClick={() => {
            set({ placing: !placing });
            if (!placing) onOpenChange(false);
          }}
          data-testid="comment-add"
        >
          <MapPin size={14} aria-hidden /> {placing ? t('comments.placing') : t('comments.add')}
        </button>
        <div className="hud-seg ml-auto">
          <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
            {t('comments.open', { n: all.filter((c) => !c.resolved).length })}
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {t('comments.all', { n: all.length })}
          </button>
        </div>
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-muted">{t('comments.name')}</span>
        <input
          className="field flex-1"
          value={name}
          placeholder={t('comments.me')}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      {list.length === 0 && <p className="p-6 text-center text-sm text-muted">{t('comments.empty')}</p>}
      <ul className="space-y-2" data-testid="comment-list">
        {list.map((c) => {
          const n = all.indexOf(c) + 1;
          const isActive = active === c.id;
          return (
            <li
              key={c.id}
              className={`hud-section p-2 text-xs ${c.resolved ? 'opacity-60' : ''}`}
              data-testid="comment-thread"
            >
              <button
                className="w-full text-left"
                onClick={() => {
                  set({ active: isActive ? null : c.id });
                  const s = store.getState();
                  if (s.levelId !== c.levelId) s.setLevel(c.levelId);
                  if (s.view === '3d')
                    viewer3dApi.get()?.setCamera({
                      position: [c.position[0] + 3000, 3500, c.position[2] + 3000],
                      target: [c.position[0], c.position[1] || 1000, c.position[2]],
                      fovDeg: 50,
                    });
                }}
              >
                <p>
                  <b className="mr-1 rounded bg-danger px-1 text-white">{n}</b>
                  <b>{c.author}</b>
                  <span className="ml-1 text-muted">{new Date(c.at).toLocaleString(i18n.language)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
              </button>
              {(isActive || c.replies.length > 0) && (
                <ul className="mt-1 space-y-1 border-l border-border pl-2">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <b>{r.author}</b>
                      <span className="ml-1 text-muted">{new Date(r.at).toLocaleString(i18n.language)}</span>
                      <p className="whitespace-pre-wrap">{r.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              {isActive && (
                <form
                  className="mt-2 flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    store.getState().exec(replyComment(c.id, me, reply.trim()));
                    setReply('');
                  }}
                >
                  <input
                    className="field flex-1"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={t('comments.reply')}
                    data-testid="comment-reply"
                  />
                  <button className="btn" disabled={!reply.trim()}>
                    {t('comments.send')}
                  </button>
                </form>
              )}
              <div className="mt-2 flex gap-1">
                <button
                  className="btn"
                  onClick={() => store.getState().exec(resolveComment(c.id, !c.resolved))}
                  data-testid="comment-resolve"
                >
                  {c.resolved ? <RotateCcw size={12} aria-hidden /> : <Check size={12} aria-hidden />}{' '}
                  {c.resolved ? t('comments.reopen') : t('comments.resolve')}
                </button>
                <button
                  className="icon-btn ml-auto"
                  title={t('comments.delete')}
                  onClick={() => store.getState().exec(deleteComment(c.id))}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {view === '2d' && <p className="mt-2 text-[11px] text-muted">{t('comments.hint')}</p>}
    </HudDialog>
  );
}

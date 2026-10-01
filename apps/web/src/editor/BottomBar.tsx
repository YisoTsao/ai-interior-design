import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, Trophy, X } from 'lucide-react';
import { activeLevel } from '@interiorai/app-state';
import { findCollisions } from '@interiorai/core-geometry';
import { collisionInputs } from '@interiorai/editor-2d';
import { catalog } from '../catalogData';
import { useEditor, useEditorStore } from './context';
import { ACHIEVEMENTS, useAchievements } from './achievements';

/** 底部：警示（穿牆/重疊，不阻擋）與操作提示；aria-live 讓讀屏得知 */
export function BottomBar() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const notices = useEditor((s) => s.notices);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const level = activeLevel({ scene, levelId });
  const name = (id: string) => {
    const o = level.objects.find((x) => x.id === id);
    const e = o ? catalog.get(o.catalogId) : undefined;
    return (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? id;
  };
  const done = useAchievements(store, catalog, (a) =>
    store.getState().notify('info', t('achieve.unlocked', { name: t(`achieve.items.${a}.title`) })),
  );
  const next = ACHIEVEMENTS.find((a) => !done.has(a));
  const warnings = useMemo(() => findCollisions(level, collisionInputs(level, catalog)), [level]);
  return (
    <footer className="hud-bar-bottom flex min-h-9 items-center gap-3 px-3 py-1 text-xs">
      <span className="flex items-center gap-2 font-mono text-[11px] text-muted" data-testid="status">
        <span className="text-accent">{t(`top.${view === '2d' ? 'view2d' : 'view3d'}`)}</span>
        <span>
          {t('status.tool')} <b className="text-fg">{t(`tools.${tool}`)}</b>
        </span>
        <span>
          {t('status.selected')} <b className="text-fg">{selection.length}</b>
        </span>
        <span className="hidden lg:inline">{t('status.keys')}</span>
      </span>
      <div aria-live="polite" className="flex flex-1 flex-wrap items-center gap-2">
        {notices.map((n) => (
          <span
            key={n.id}
            role={n.kind === 'error' ? 'alert' : 'status'}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${n.kind === 'info' ? 'text-muted' : n.kind === 'warn' ? 'text-warn' : 'text-danger'}`}
            data-testid="notice"
          >
            {n.kind === 'info' ? <Info size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
            {n.code ? t(`error.${n.code}`, { defaultValue: n.message }) : n.message}
            <button aria-label={t('error.dismiss')} onClick={() => store.getState().dismiss(n.id)}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <details className="relative" data-testid="achievements">
        <summary className="cursor-pointer text-muted">
          <Trophy size={12} className="inline text-primary" aria-hidden />{' '}
          {t('achieve.progress', { n: done.size, total: ACHIEVEMENTS.length })}
        </summary>
        <div className="hud-popover absolute right-0 bottom-6 z-10 w-72 space-y-1 p-2">
          <div className="h-1.5 w-full bg-black/30">
            <div
              className="h-full bg-primary"
              style={{ width: `${(done.size / ACHIEVEMENTS.length) * 100}%` }}
            />
          </div>
          <ul className="space-y-1">
            {ACHIEVEMENTS.map((a) => (
              <li key={a} className={`flex gap-2 ${done.has(a) ? '' : 'opacity-60'}`} data-done={done.has(a)}>
                <span aria-hidden>{done.has(a) ? '★' : '☆'}</span>
                <span>
                  <b>{t(`achieve.items.${a}.title`)}</b>
                  <br />
                  <span className="text-muted">{t(`achieve.items.${a}.hint`)}</span>
                </span>
              </li>
            ))}
          </ul>
          {next && (
            <p className="text-accent">{t('achieve.next', { name: t(`achieve.items.${next}.title`) })}</p>
          )}
        </div>
      </details>
      <details className="relative" data-testid="warnings">
        <summary className={`cursor-pointer ${warnings.length ? 'text-warn' : 'text-muted'}`}>
          <AlertTriangle size={12} className="inline" aria-hidden />{' '}
          {warnings.length ? t('warn.count', { count: warnings.length }) : t('warn.none')}
        </summary>
        {warnings.length > 0 && (
          <ul className="hud-popover absolute right-0 bottom-6 z-10 w-72 p-2">
            {warnings.map((w, i) => (
              <li key={i}>
                <button
                  className="w-full text-left hover:underline"
                  onClick={() => store.getState().select([w.objectId])}
                >
                  {w.kind === 'wall'
                    ? t('warn.wall', { name: name(w.objectId) })
                    : t('warn.object', { a: name(w.objectId), b: name(w.otherId!) })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </footer>
  );
}

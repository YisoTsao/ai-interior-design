import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, X } from 'lucide-react';
import { activeLevel } from '@interiorai/app-state';
import { findCollisions } from '@interiorai/core-geometry';
import { collisionInputs } from '@interiorai/editor-2d';
import { catalog } from '../catalogData';
import { useEditor, useEditorStore } from './context';

/** 底部：警示（穿牆/重疊，不阻擋）與操作提示；aria-live 讓讀屏得知 */
export function BottomBar() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const notices = useEditor((s) => s.notices);
  const level = activeLevel({ scene, levelId });
  const name = (id: string) => {
    const o = level.objects.find((x) => x.id === id);
    const e = o ? catalog.get(o.catalogId) : undefined;
    return (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? id;
  };
  const warnings = useMemo(() => findCollisions(level, collisionInputs(level, catalog)), [level]);
  return (
    <footer className="flex min-h-9 items-center gap-3 border-t border-border bg-surface px-3 py-1 text-xs">
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
      <details className="relative" data-testid="warnings">
        <summary className={`cursor-pointer ${warnings.length ? 'text-warn' : 'text-muted'}`}>
          <AlertTriangle size={12} className="inline" aria-hidden />{' '}
          {warnings.length ? t('warn.count', { count: warnings.length }) : t('warn.none')}
        </summary>
        {warnings.length > 0 && (
          <ul className="absolute bottom-6 right-0 z-10 w-72 rounded-lg border border-border bg-surface p-2 shadow">
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

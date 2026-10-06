import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadKeymap, REBINDABLE, saveKeymap } from './keymap';
import { HudDialog } from './HudDialog';
import { SHORTCUT_LIST } from './shortcuts';

/** 快捷鍵一覽（FE-UX-03；按 ? 開啟） */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const groups = ['general', 'tools', 'edit', 'view'] as const;
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('shortcuts.title')}
      testId="shortcuts-dialog"
      width={720}
    >
      <KeymapEditor />
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs font-bold text-primary">{t(`shortcuts.groups.${g}`)}</h3>
            <dl className="space-y-1 text-sm">
              {SHORTCUT_LIST.filter((x) => x[2] === g).map(([k, label]) => (
                <div
                  key={k + label}
                  className="flex items-center justify-between gap-2 border-b border-border/40 py-0.5"
                >
                  <dt>{t(label)}</dt>
                  <dd>
                    <kbd className="hud-chip text-[11px]">{k}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </HudDialog>
  );
}

/** 改綁單鍵快捷鍵：點按鈕後按下新鍵；Esc 取消；可全部還原 */
function KeymapEditor() {
  const { t } = useTranslation();
  const [map, setMap] = useState(loadKeymap);
  const [capture, setCapture] = useState<string | null>(null);
  useEffect(() => {
    if (!capture) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapture(null);
      const key = e.key.toLowerCase();
      if (!/^[a-z0-9]$/.test(key)) return;
      // 同一個鍵只能綁一個動作：先移除其他使用這個鍵的綁定
      const next = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== key));
      if (key !== capture) next[capture] = key;
      else delete next[capture];
      setMap(next);
      saveKeymap(next);
      setCapture(null);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [capture, map]);
  return (
    <details className="hud-section mb-3 p-2" data-testid="keymap-editor">
      <summary className="cursor-pointer text-xs font-bold text-primary">{t('shortcuts.customize')}</summary>
      <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
        {REBINDABLE.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span>{t(r.label)}</span>
            <button
              className="hud-chip font-mono"
              onClick={() => setCapture(r.key)}
              data-testid={`rebind-${r.key}`}
            >
              {capture === r.key ? t('shortcuts.pressKey') : (map[r.key] ?? r.key).toUpperCase()}
            </button>
          </li>
        ))}
      </ul>
      <button
        className="btn mt-2"
        onClick={() => {
          setMap({});
          saveKeymap({});
        }}
      >
        {t('shortcuts.reset')}
      </button>
    </details>
  );
}

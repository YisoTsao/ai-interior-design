import { useTranslation } from 'react-i18next';
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

import { useTranslation } from 'react-i18next';
import { Copy, Layers, Plus, Settings2, Trash2 } from 'lucide-react';
import { addLevel, deleteLevel, duplicateLevel, updateLevel } from '@interiorai/app-state';
import { useEditor, useEditorStore } from './context';
import type { PromptField } from './PromptDialog';

/**
 * 樓層選擇器（FE-LVL-01）：畫布左下角的樓層列（上層在上），新增／複製／刪除／設定（名稱、樓高、樓板厚）。
 */
export function LevelBar({
  ask,
}: {
  ask: (title: string, f: PromptField[]) => Promise<Record<string, string> | null>;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const levels = useEditor((s) => s.scene.levels);
  const levelId = useEditor((s) => s.levelId);
  const exec = store.getState().exec;
  const sorted = [...levels].sort((a, b) => b.elevation - a.elevation);
  const cur = levels.find((l) => l.id === levelId);
  return (
    <div
      className="hud-panel absolute bottom-3 left-3 z-10 flex w-44 flex-col gap-1 p-1.5 text-xs"
      role="group"
      aria-label={t('level.title')}
      data-testid="level-bar"
    >
      <div className="flex items-center gap-1 px-1 text-muted">
        <Layers size={12} aria-hidden /> <span className="flex-1">{t('level.title')}</span>
        <button
          className="icon-btn h-6 w-6"
          aria-label={t('level.add')}
          title={t('level.add')}
          data-testid="level-add"
          onClick={() => {
            const c = addLevel({ copyWallsFrom: levelId });
            if (exec(c)) store.getState().setLevel(c.levelId);
          }}
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>
      {sorted.map((l) => (
        <button
          key={l.id}
          className={`flex items-center justify-between px-2 py-1 text-left ${l.id === levelId ? 'bg-primary font-bold text-primary-fg' : 'hover:bg-surface-2'}`}
          aria-pressed={l.id === levelId}
          onClick={() => store.getState().setLevel(l.id)}
          data-testid={`level-${l.name ?? l.id}`}
        >
          <span>{l.name || t('level.unnamed')}</span>
          <span className="font-mono text-[10px] opacity-70">{`${(l.elevation / 1000).toFixed(2)} m`}</span>
        </button>
      ))}
      <div className="flex justify-end gap-1 border-t border-border pt-1">
        <button
          className="icon-btn h-6 w-6"
          aria-label={t('level.settings')}
          title={t('level.settings')}
          onClick={async () => {
            if (!cur) return;
            const r = await ask(t('level.settings'), [
              { key: 'name', label: t('level.name'), value: cur.name ?? '' },
              { key: 'height', label: t('level.height'), value: String(cur.height), type: 'number' },
              {
                key: 'slab',
                label: t('level.slab'),
                value: String(cur.slabThickness ?? 150),
                type: 'number',
              },
            ]);
            if (!r) return;
            exec(
              updateLevel(cur.id, {
                name: r.name?.trim() || cur.name,
                height: Math.round(Number(r.height) || cur.height),
                slabThickness: Math.round(Number(r.slab) || 0),
              }),
            );
          }}
        >
          <Settings2 size={13} aria-hidden />
        </button>
        <button
          className="icon-btn h-6 w-6"
          aria-label={t('level.duplicate')}
          title={t('level.duplicate')}
          onClick={() => {
            const c = duplicateLevel(levelId);
            if (exec(c)) store.getState().setLevel(c.levelId);
          }}
        >
          <Copy size={13} aria-hidden />
        </button>
        <button
          className="icon-btn h-6 w-6"
          aria-label={t('level.delete')}
          title={t('level.delete')}
          disabled={levels.length <= 1}
          onClick={() => {
            if (cur && window.confirm(t('level.confirmDelete', { name: cur.name ?? '' })))
              exec(deleteLevel(cur.id));
          }}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}

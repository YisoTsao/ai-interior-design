import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { activeLevel } from '@interiorai/app-state';
import { applyStyle, captureStyle, type StyleClip } from './actions';
import { useEditor, useEditorStore } from './context';
import { Section } from './fields';

/**
 * 樣式預設（FE-PROP-06）：把選取項目的材質＋外觀（物件／牆／房間）存成具名預設（本機、跨專案），
 * 之後一鍵套用到同類型的選取項目（單一 undo）。
 */
export interface StylePreset {
  id: string;
  name: string;
  clip: StyleClip;
}
const KEY = 'stylePresets';
export function loadPresets(): StylePreset[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as StylePreset[];
  } catch {
    return [];
  }
}
function savePresets(list: StylePreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 私密模式 */
  }
}

export function StylePresetsSection() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const level = useEditor(activeLevel);
  const selection = useEditor((s) => s.selection);
  const [list, setList] = useState(loadPresets);
  const [name, setName] = useState('');
  const kindOf = (id: string) =>
    level.objects.some((o) => o.id === id)
      ? 'object'
      : level.walls.some((w) => w.id === id)
        ? 'wall'
        : level.rooms.some((r) => r.id === id)
          ? 'room'
          : null;
  const kinds = new Set(selection.map(kindOf));
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  if (!kind) return null;
  const mine = list.filter((p) => p.clip.kind === kind);
  const update = (next: StylePreset[]) => {
    setList(next);
    savePresets(next);
  };
  return (
    <Section title={t('preset.title')} defaultOpen={false} testId="section-style-presets">
      <div className="flex gap-1">
        <input
          className="field min-w-0 flex-1"
          value={name}
          placeholder={t('preset.namePh')}
          aria-label={t('preset.name')}
          onChange={(e) => setName(e.target.value)}
          data-testid="preset-name"
        />
        <button
          className="btn px-2"
          disabled={selection.length !== 1}
          title={selection.length !== 1 ? t('preset.saveOne') : undefined}
          onClick={() => {
            const clip = captureStyle(level, selection[0]);
            if (!clip) return;
            update([
              ...list,
              {
                id: crypto.randomUUID(),
                name: name.trim() || t('preset.defaultName', { n: list.length + 1 }),
                clip,
              },
            ]);
            setName('');
          }}
          data-testid="preset-save"
        >
          {t('preset.save')}
        </button>
      </div>
      {mine.length === 0 ? (
        <p className="text-[11px] text-muted">{t('preset.empty')}</p>
      ) : (
        <ul className="space-y-1" data-testid="preset-list">
          {mine.map((p) => (
            <li key={p.id} className="flex items-center gap-1 text-xs">
              <button
                className="btn flex-1 justify-start px-2 py-0.5"
                onClick={() => {
                  const cmd = applyStyle(activeLevel(store.getState()), store.getState().selection, p.clip);
                  if (cmd) store.getState().exec(cmd);
                }}
                data-testid={`preset-apply-${p.name}`}
              >
                {p.name}
              </button>
              <button
                className="icon-btn h-6 w-6"
                aria-label={t('preset.delete', { name: p.name })}
                onClick={() => update(list.filter((x) => x.id !== p.id))}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

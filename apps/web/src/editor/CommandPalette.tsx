import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import type { Tool } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { catalog } from '../catalogData';
import { usePrefs } from '../prefs';
import { editActions } from './actions';
import { useEditorStore } from './context';

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

const TOOL_KEYS: [Tool, string, string?][] = [
  ['select', 'tools.select', 'V'],
  ['wall', 'tools.wall', 'W'],
  ['rect', 'tools.rect'],
  ['polygon', 'tools.polygon', 'P'],
  ['arc', 'tools.arc', 'C'],
  ['door', 'tools.door', 'D'],
  ['window', 'tools.window', 'N'],
  ['measure', 'tools.measure', 'M'],
  ['dimension', 'tools.dimension', 'K'],
  ['text', 'tools.text', 'T'],
  ['angle', 'tools.angle'],
  ['arrow', 'tools.arrow'],
  ['tag', 'tools.tag'],
  ['pan', 'tools.pan'],
];

/**
 * 指令面板（FE-UX-02）：Ctrl/⌘+K 搜尋工具、動作、面板、設定與資產（選資產＝進入放置模式）。
 * ↑↓ 選擇、Enter 執行、Esc 關閉。
 */
export function CommandPalette({
  open,
  onOpenChange,
  panels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 由編輯器提供的面板指令（報價、圖庫…） */
  panels: PaletteCommand[];
}) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
    }
  }, [open]);

  const base = useMemo<PaletteCommand[]>(() => {
    const act = editActions(store);
    const s = () => store.getState();
    const g = {
      tool: t('palette.groups.tools'),
      edit: t('palette.groups.edit'),
      view: t('palette.groups.view'),
      set: t('palette.groups.settings'),
    };
    return [
      ...TOOL_KEYS.map(([tool, key, hk]) => ({
        id: `tool:${tool}`,
        label: t(key),
        group: g.tool,
        ...(hk ? { hint: hk } : {}),
        run: () => {
          if (s().view !== '2d' && tool !== 'select') s().setView('2d');
          s().setTool(tool);
        },
      })),
      { id: 'undo', label: t('shortcuts.undo'), group: g.edit, hint: 'Ctrl Z', run: () => s().undo() },
      { id: 'redo', label: t('shortcuts.redo'), group: g.edit, hint: 'Ctrl Y', run: () => s().redo() },
      {
        id: 'selectAll',
        label: t('shortcuts.selectAll'),
        group: g.edit,
        hint: 'Ctrl A',
        run: () => act.selectAll(),
      },
      { id: 'selectSame', label: t('ctx.selectSame'), group: g.edit, run: () => act.selectSame() },
      {
        id: 'duplicate',
        label: t('shortcuts.duplicate'),
        group: g.edit,
        hint: 'Ctrl D',
        run: () => act.duplicate(),
      },
      { id: 'delete', label: t('shortcuts.delete'), group: g.edit, hint: 'Del', run: () => act.del() },
      { id: 'group', label: t('ctx.group'), group: g.edit, hint: 'Ctrl G', run: () => act.group() },
      { id: 'ungroup', label: t('ctx.ungroup'), group: g.edit, run: () => act.ungroup() },
      { id: 'mirrorX', label: t('ctx.mirrorX'), group: g.edit, run: () => act.mirror('x') },
      { id: 'rot90', label: t('shortcuts.rotate'), group: g.edit, hint: 'E', run: () => act.rotate(90) },
      { id: 'view2d', label: t('top.view2d'), group: g.view, hint: 'Tab', run: () => s().setView('2d') },
      { id: 'view3d', label: t('top.view3d'), group: g.view, hint: 'Tab', run: () => s().setView('3d') },
      {
        id: 'walk',
        label: t('top.walk'),
        group: g.view,
        run: () => {
          s().setView('3d');
          setTimeout(() => viewer3dApi.get()?.walk(true), 300);
        },
      },
      {
        id: 'frame',
        label: t('top.frameAll'),
        group: g.view,
        hint: 'F',
        run: () => viewer3dApi.get()?.frameAll(),
      },
      { id: 'day', label: t('top.lightingDay'), group: g.set, run: () => prefs.setLighting('day') },
      { id: 'night', label: t('top.lightingNight'), group: g.set, run: () => prefs.setLighting('night') },
      {
        id: 'dollhouse',
        label: t('top.styleDollhouse'),
        group: g.set,
        run: () => prefs.setViewStyle('dollhouse'),
      },
      { id: 'simple', label: t('top.styleSimple'), group: g.set, run: () => prefs.setViewStyle('simple') },
      ...(['mm', 'cm', 'm'] as const).map((u) => ({
        id: `unit:${u}`,
        label: `${t('units.length')}: ${t(`units.${u}`)}`,
        group: g.set,
        run: () => prefs.setLength(u),
      })),
      {
        id: 'lang',
        label: i18n.language === 'en' ? '切換為繁體中文' : 'Switch to English',
        group: g.set,
        run: () => void i18n.changeLanguage(i18n.language === 'en' ? 'zh-TW' : 'en'),
      },
    ];
  }, [store, t, i18n, prefs]);

  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    const cmds = [...panels, ...base].filter(
      (c) => !k || c.label.toLowerCase().includes(k) || c.id.includes(k),
    );
    // 資產：輸入 2 個字以上才搜尋
    const assets: PaletteCommand[] =
      k.length >= 1
        ? catalog
            .all()
            .filter((e) => e.status === 'published')
            .filter((e) => [e.nameZh, e.nameEn ?? '', ...e.tags].some((x) => x.toLowerCase().includes(k)))
            .slice(0, 8)
            .map((e) => ({
              id: `asset:${e.id}`,
              label: i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh,
              group: t('palette.groups.assets'),
              hint: t('palette.place'),
              run: () => {
                const s = store.getState();
                if (s.view !== '2d') s.setView('2d');
                s.setTool('place', e.id);
              },
            }))
        : [];
    return [...cmds, ...assets].slice(0, 40);
  }, [q, base, panels, store, t, i18n.language]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [i]);
  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // 等對話框關閉、焦點還給畫布後再執行
    setTimeout(c.run, 0);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="game-ui hud-panel fixed top-[15vh] left-1/2 z-50 w-[min(560px,94vw)] -translate-x-1/2 p-2"
          data-testid="command-palette"
        >
          <Dialog.Title className="sr-only">{t('palette.title')}</Dialog.Title>
          <label className="relative block">
            <Search size={14} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              autoFocus
              className="field w-full"
              style={{ paddingLeft: 28 }}
              placeholder={t('palette.placeholder')}
              aria-label={t('palette.placeholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setI((x) => Math.min(results.length - 1, x + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setI((x) => Math.max(0, x - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  run(results[i]);
                }
              }}
              data-testid="palette-input"
            />
          </label>
          <ul ref={list} className="mt-2 max-h-[50vh] overflow-y-auto" role="listbox">
            {results.map((c, k) => (
              <li
                key={c.id}
                role="option"
                aria-selected={k === i}
                data-idx={k}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                  k === i ? 'bg-primary/20 text-primary' : ''
                }`}
                onMouseEnter={() => setI(k)}
                onClick={() => run(c)}
              >
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-[11px] text-muted">{c.group}</span>
                {c.hint && <kbd className="hud-chip text-[10px]">{c.hint}</kbd>}
              </li>
            ))}
            {results.length === 0 && (
              <li className="p-3 text-center text-xs text-muted">{t('palette.none')}</li>
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

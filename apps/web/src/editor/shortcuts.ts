import { useEffect } from 'react';
import { type EditorStore } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { editActions } from './actions';
import { translateKey } from './keymap';

export type TransformMode = 'translate' | 'rotate' | 'scale';

/** 快捷鍵一覽（FE-UX-03）：[按鍵, 說明 i18n key, 分組] */
export const SHORTCUT_LIST: [string, string, 'general' | 'tools' | 'edit' | 'view'][] = [
  ['Ctrl/⌘ K', 'shortcuts.palette', 'general'],
  ['?', 'shortcuts.help', 'general'],
  ['\\', 'shortcuts.panels', 'general'],
  ['Ctrl/⌘ Z', 'shortcuts.undo', 'general'],
  ['Ctrl/⌘ Shift Z · Ctrl Y', 'shortcuts.redo', 'general'],
  ['V', 'tools.select', 'tools'],
  ['W', 'tools.wall', 'tools'],
  ['P', 'tools.polygon', 'tools'],
  ['C', 'tools.arc', 'tools'],
  ['D', 'tools.door', 'tools'],
  ['N', 'tools.window', 'tools'],
  ['M', 'tools.measure', 'tools'],
  ['K', 'tools.dimension', 'tools'],
  ['T', 'tools.text', 'tools'],
  ['Space', 'tools.pan', 'tools'],
  ['Esc', 'shortcuts.escape', 'tools'],
  ['Ctrl/⌘ C · X · V', 'shortcuts.clipboard', 'edit'],
  ['Ctrl/⌘ D', 'shortcuts.duplicate', 'edit'],
  ['Ctrl/⌘ Shift C · V', 'shortcuts.style', 'edit'],
  ['Ctrl/⌘ A', 'shortcuts.selectAll', 'edit'],
  ['Ctrl/⌘ G · Shift G', 'shortcuts.group', 'edit'],
  ['Q · E', 'shortcuts.rotate', 'edit'],
  ['L', 'shortcuts.lock', 'edit'],
  ['H', 'shortcuts.hide', 'edit'],
  ['Delete', 'shortcuts.delete', 'edit'],
  ['Tab', 'shortcuts.toggleView', 'view'],
  ['G · R · S', 'shortcuts.gizmo', 'view'],
  ['F', 'shortcuts.frame', 'view'],
  ['W A S D · Shift', 'shortcuts.walk', 'view'],
];

export interface ShortcutExtras {
  palette?: () => void;
  help?: () => void;
  togglePanels?: () => void;
}

/** 02 §4 快捷鍵。輸入框聚焦或事件已被畫布消費（defaultPrevented）時不處理。 */
export function useShortcuts(
  store: EditorStore,
  setMode: (m: TransformMode) => void,
  extras: ShortcutExtras = {},
) {
  useEffect(() => {
    let spacePrev: ReturnType<EditorStore['getState']>['tool'] | null = null;
    const act = editActions(store);
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return;
      const s = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') return (e.preventDefault(), extras.palette?.());
      if (!mod && e.key === '?') return (e.preventDefault(), extras.help?.());
      if (!mod && e.key === '\\') return (e.preventDefault(), extras.togglePanels?.());
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && k === 'y') return (e.preventDefault(), s.redo());
      if (mod && k === 'd') {
        e.preventDefault();
        return act.duplicate();
      }
      if (mod && e.shiftKey && k === 'c') return (e.preventDefault(), act.copyStyle());
      if (mod && e.shiftKey && k === 'v') return (e.preventDefault(), act.pasteStyle());
      if (mod && k === 'c') return act.copy();
      if (mod && k === 'x') return (e.preventDefault(), act.cut());
      if (mod && k === 'v') return (e.preventDefault(), act.paste());
      if (mod && k === 'a') return (e.preventDefault(), act.selectAll());
      if (mod && k === 'g') return (e.preventDefault(), e.shiftKey ? act.ungroup() : act.group());
      if (mod || e.altKey) return;
      const tk = translateKey(k);
      if (tk === null) return;
      switch (tk) {
        case 'v':
          return s.setTool('select');
        case 'w':
          return s.view === '2d' && s.setTool('wall');
        case 'd':
          return s.view === '2d' && s.setTool('door');
        case 'n':
          return s.view === '2d' && s.setTool('window');
        case 'g':
          return setMode('translate');
        case 'r':
          return setMode('rotate');
        case 's':
          return setMode('scale');
        case 'h':
          return act.toggleHide();
        case 'l':
          return act.toggleLock();
        case 'e':
          return act.rotate(90);
        case 'q':
          return act.rotate(-90);
        case 'p':
          return s.view === '2d' && s.setTool('polygon');
        case 'c':
          return s.view === '2d' && s.setTool('arc');
        case 'm':
          return s.view === '2d' && s.setTool('measure');
        case 'k':
          return s.view === '2d' && s.setTool('dimension');
        case 't':
          return s.view === '2d' && s.setTool('text');
        case 'f':
          return s.view === '3d' && viewer3dApi.get()?.frameAll();
        case 'tab':
          e.preventDefault();
          return s.setView(s.view === '2d' ? '3d' : '2d');
        case 'delete':
        case 'backspace':
          if (s.selection.length) {
            e.preventDefault();
            act.del();
          }
          return;
        case 'escape':
          s.setTool('select');
          return s.select([]);
        case ' ':
          if (!spacePrev && s.view === '2d') {
            spacePrev = s.tool;
            s.setTool('pan');
            e.preventDefault();
          }
          return;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spacePrev) {
        store.getState().setTool(spacePrev);
        spacePrev = null;
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [store, setMode, extras.palette, extras.help, extras.togglePanels]);
}

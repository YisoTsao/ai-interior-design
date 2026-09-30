import { useEffect } from 'react';
import { deleteEntities, duplicateObjects, updateObject, type EditorStore } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';

export type TransformMode = 'translate' | 'rotate' | 'scale';

/** 02 §4 快捷鍵。輸入框聚焦或事件已被畫布消費（defaultPrevented）時不處理。 */
export function useShortcuts(store: EditorStore, setMode: (m: TransformMode) => void) {
  useEffect(() => {
    let spacePrev: ReturnType<EditorStore['getState']>['tool'] | null = null;
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
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && k === 'y') return (e.preventDefault(), s.redo());
      if (mod && k === 'd') {
        e.preventDefault();
        const objs = s.selection.filter((id) =>
          s.scene.levels.some((l) => l.objects.some((o) => o.id === id)),
        );
        if (objs.length) {
          const c = duplicateObjects(s.levelId, objs);
          if (s.exec(c)) s.select(c.newIds);
        }
        return;
      }
      if (mod || e.altKey) return;
      switch (k) {
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
        case 'h': {
          // 隱藏／顯示選取的家具（外觀覆寫 hidden）
          const lv = s.scene.levels.find((l) => l.id === s.levelId);
          const objs = lv?.objects.filter((o) => s.selection.includes(o.id)) ?? [];
          if (!objs.length) return;
          const hide = objs.some((o) => !o.appearance?.hidden);
          for (const o of objs) {
            const next = { ...(o.appearance ?? {}) };
            if (hide) next.hidden = true;
            else delete next.hidden;
            s.exec(
              updateObject(s.levelId, o.id, { appearance: Object.keys(next).length ? next : undefined }),
            );
          }
          return;
        }
        case 'f':
          return s.view === '3d' && viewer3dApi.get()?.frameAll();
        case 'tab':
          e.preventDefault();
          return s.setView(s.view === '2d' ? '3d' : '2d');
        case 'delete':
        case 'backspace':
          if (s.selection.length) {
            e.preventDefault();
            s.exec(deleteEntities(s.levelId, s.selection));
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
  }, [store, setMode]);
}

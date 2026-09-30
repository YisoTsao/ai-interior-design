import { createStore, type StoreApi } from 'zustand/vanilla';
import { CURRENT_SCHEMA_VERSION, newId, type Level, type Scene } from '@interiorai/scene-schema';
import {
  CommandRejected,
  execCommand,
  redo as redoH,
  undo as undoH,
  type Command,
  type HistoryState,
} from './history.js';

export type Tool =
  | 'select'
  | 'wall'
  | 'rect'
  | 'polygon'
  | 'door'
  | 'window'
  | 'place'
  | 'pan'
  | 'measure'
  | 'dimension'
  | 'text'
  | 'paint';
export type ViewMode = '2d' | '3d';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
export interface Notice {
  id: number;
  kind: 'info' | 'warn' | 'error';
  /** 後備訊息（繁中）；UI 以 code 查 i18n 鍵 `error.<code>` */
  message: string;
  code?: string;
}

export interface EditorState {
  projectId: string;
  projectName: string;
  scene: Scene;
  levelId: string;
  history: HistoryState;
  /** 暫態（不進歷史、不存檔，B4） */
  selection: string[];
  tool: Tool;
  placeCatalogId: string | null;
  view: ViewMode;
  layers: { structure: boolean; furniture: boolean; annotation: boolean };
  snapEnabled: boolean;
  /** 拖曳中的預覽樓層；pointerup 才以 Command 提交 */
  preview: Level | null;
  saveStatus: SaveStatus;
  notices: Notice[];
  revision: number;
}

export interface EditorActions {
  exec(cmd: Command): boolean;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  setTool(t: Tool, catalogId?: string): void;
  setView(v: ViewMode): void;
  toggleLayer(k: keyof EditorState['layers']): void;
  setSnap(on: boolean): void;
  setPreview(l: Level | null): void;
  setSaveStatus(s: SaveStatus): void;
  notify(kind: Notice['kind'], message: string, code?: string): void;
  dismiss(id: number): void;
  load(p: { projectId: string; projectName: string; scene: Scene }): void;
  rename(name: string): void;
  /** 切換作用中的樓層（UI 狀態） */
  setLevel(levelId: string): void;
  /** 跳到歷史中的某一步（負數＝往回幾步、正數＝往前幾步） */
  jump(steps: number): void;
}

export type EditorStore = StoreApi<EditorState & EditorActions>;

export function emptyScene(): Scene {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    units: 'mm',
    levels: [
      {
        id: newId('lvl'),
        name: '1F',
        elevation: 0,
        height: 2800,
        walls: [],
        openings: [],
        rooms: [],
        objects: [],
      },
    ],
    meta: { source: 'manual' },
  };
}

let noticeSeq = 1;

export function createEditorStore(init?: {
  projectId?: string;
  projectName?: string;
  scene?: Scene;
}): EditorStore {
  const scene = init?.scene ?? emptyScene();
  return createStore<EditorState & EditorActions>()((set, get) => ({
    projectId: init?.projectId ?? newId('obj').replace('obj_', 'p_'),
    projectName: init?.projectName ?? '',
    scene,
    levelId: scene.levels[0]!.id,
    history: { past: [], future: [] },
    selection: [],
    tool: 'select',
    placeCatalogId: null,
    view: '2d',
    layers: { structure: true, furniture: true, annotation: true },
    snapEnabled: true,
    preview: null,
    saveStatus: 'saved',
    notices: [],
    revision: 0,

    exec(cmd) {
      const s = get();
      try {
        const r = execCommand(s.scene, s.history, cmd);
        if (!r.changed) return false;
        const ids = new Set(allIds(r.scene));
        set({
          scene: r.scene,
          history: r.history,
          preview: null,
          saveStatus: 'dirty',
          revision: s.revision + 1,
          selection: s.selection.filter((id) => ids.has(id)),
          levelId: r.scene.levels.some((l) => l.id === s.levelId) ? s.levelId : r.scene.levels[0]!.id,
        });
        return true;
      } catch (e) {
        set({ preview: null });
        if (e instanceof CommandRejected) {
          get().notify('warn', e.message, e.reasons[0]?.code);
          return false;
        }
        throw e;
      }
    },
    undo() {
      const s = get();
      const r = undoH(s.scene, s.history);
      if (!r.entry) return;
      const ids = new Set(allIds(r.scene));
      set({
        scene: r.scene,
        history: r.history,
        saveStatus: 'dirty',
        revision: s.revision + 1,
        selection: s.selection.filter((id) => ids.has(id)),
        levelId: r.scene.levels.some((l) => l.id === s.levelId) ? s.levelId : r.scene.levels[0]!.id,
      });
    },
    redo() {
      const s = get();
      const r = redoH(s.scene, s.history);
      if (!r.entry) return;
      set({
        scene: r.scene,
        history: r.history,
        saveStatus: 'dirty',
        revision: s.revision + 1,
        levelId: r.scene.levels.some((l) => l.id === s.levelId) ? s.levelId : r.scene.levels[0]!.id,
      });
    },
    select(ids, additive = false) {
      const cur = get().selection;
      set({
        selection: additive
          ? [...new Set([...cur.filter((x) => !ids.includes(x)), ...ids.filter((x) => !cur.includes(x))])]
          : [...ids],
      });
    },
    setTool(tool, catalogId) {
      // place：要放的家具；door／window：門窗樣式的目錄項；paint：要套用的材質 id
      set({
        tool,
        placeCatalogId:
          tool === 'place' || tool === 'door' || tool === 'window' || tool === 'paint'
            ? (catalogId ?? null)
            : null,
        preview: null,
      });
    },
    setView: (view) => set({ view }),
    toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
    setSnap: (snapEnabled) => set({ snapEnabled }),
    setPreview: (preview) => set({ preview }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),
    notify(kind, message, code) {
      const n: Notice = { id: noticeSeq++, kind, message, ...(code ? { code } : {}) };
      set({ notices: [...get().notices.slice(-4), n] });
    },
    dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
    load({ projectId, projectName, scene }) {
      set({
        projectId,
        projectName,
        scene,
        levelId: scene.levels[0]!.id,
        history: { past: [], future: [] },
        selection: [],
        preview: null,
        saveStatus: 'saved',
        revision: get().revision + 1,
      });
    },
    rename: (projectName) => set({ projectName, saveStatus: 'dirty' }),
    setLevel(levelId) {
      if (get().scene.levels.some((l) => l.id === levelId)) set({ levelId, selection: [], preview: null });
    },
    jump(steps) {
      for (let i = 0; i < Math.abs(steps); i++) (steps < 0 ? get().undo : get().redo)();
    },
  }));
}

export function allIds(scene: Scene): string[] {
  return scene.levels.flatMap((l) =>
    [...l.walls, ...l.openings, ...l.rooms, ...l.objects, ...(l.annotations ?? [])].map((x) => x.id),
  );
}

export const activeLevel = (s: Pick<EditorState, 'scene' | 'levelId'>): Level =>
  s.scene.levels.find((l) => l.id === s.levelId) ?? s.scene.levels[0]!;
/** 畫面應顯示的樓層：拖曳預覽優先 */
export const displayLevel = (s: Pick<EditorState, 'scene' | 'levelId' | 'preview'>): Level =>
  s.preview ?? activeLevel(s);
export const canUndo = (s: Pick<EditorState, 'history'>) => s.history.past.length > 0;
export const canRedo = (s: Pick<EditorState, 'history'>) => s.history.future.length > 0;

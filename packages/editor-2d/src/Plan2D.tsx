import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KImage, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { useStore } from 'zustand';
import {
  activeLevel,
  addAnnotation,
  addObject,
  addOpening,
  addRectRoom,
  addWalls,
  batch,
  DEFAULTS,
  moveWallVertex,
  resizeWall,
  inferRoomKind,
  setMaterial,
  stackElevation,
  transformObject,
  translateWall,
  updateAnnotation,
  updateOpening,
  type DimensionData,
  type EditorStore,
  type TextData,
} from '@interiorai/app-state';
import { defaultElevation, objectDims, resolveParams, type Catalog } from '@interiorai/catalog';
import {
  closestOnSegment,
  detectRooms,
  findCollisions,
  moveWallVertex as geoMove,
  pointOnWall,
  signedArea,
  snap,
  wallLength,
  wallOutline,
  wallQuad,
  type SnapResult,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Level, Opening, OpeningStyle } from '@interiorai/scene-schema';
import { plan2dApi } from './api.js';
import { collisionInputs, flat, footprintOf, openingEnds } from './model.js';
import {
  bboxOf,
  fitView,
  formatArea,
  formatLength,
  gridStep,
  parseLength,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type AreaUnit,
  type LengthUnit,
  type ViewTransform,
} from './view.js';

export interface Plan2DTheme {
  bg: string;
  grid: string;
  gridMajor: string;
  wall: string;
  wallStroke: string;
  floor: string;
  text: string;
  muted: string;
  primary: string;
  warn: string;
  danger: string;
  object: string;
  opening: string;
}
export interface Plan2DProps {
  store: EditorStore;
  catalog: Catalog;
  t: (key: string, vars?: Record<string, string | number>) => string;
  lengthUnit: LengthUnit;
  areaUnit: AreaUnit;
  theme: Plan2DTheme;
  /** 右鍵選單：hit＝點到的實體 id（沒有則 null）、world＝世界座標 */
  onContextMenu?: (e: { clientX: number; clientY: number; hit: string | null; world: Vec2 }) => void;
  /** 文字標註工具：請宿主提供輸入（回傳 null＝取消） */
  requestText?: (initial: string) => Promise<string | null>;
  /** 下層樓層（淡色參考，FE-LVL-02） */
  ghostLevel?: Level | null;
  /** 格線與吸附設定（FE-PLAN-13） */
  snapSettings?: SnapSettings;
  /** 顯示樣式（FE-PLAN-12）：blueprint＝藍圖（預設）、color＝房間依用途填色、mono＝黑白施工圖 */
  planStyle?: PlanStyle;
  /** 描圖底圖（FE-PLAN-11） */
  underlay?: Underlay | null;
  /** 熱度圖（照度分析 FE-LGT-03）：格心世界座標＋顏色 */
  heatmap?: { step: number; cells: { x: number; z: number; color: string }[] } | null;
  /** 留言釘選（FE-SHR-03） */
  pins?: CommentPin[];
  onPinClick?: (id: string) => void;
}
export interface CommentPin {
  id: string;
  x: number;
  z: number;
  label: string;
  resolved: boolean;
  active: boolean;
}
export type PlanStyle = 'blueprint' | 'color' | 'mono';
export interface SnapSettings {
  gridMm?: number;
  angleDeg?: number;
  showGrid?: boolean;
  targets?: { endpoint?: boolean; wall?: boolean; angle?: boolean; grid?: boolean };
}
/** 底圖：左上角位於世界座標 (x, z)，寬 widthMm（高依影像比例），繞左上角旋轉 */
export interface Underlay {
  src: string;
  x: number;
  z: number;
  widthMm: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
}
/** 房間依用途的填色（color 樣式） */
export const ROOM_KIND_FILL: Record<string, string> = {
  living: '#f2dfbd',
  dining: '#f4cfae',
  bedroom: '#c9dcef',
  kitchen: '#d3e8c4',
  bath: '#bfe3e8',
  study: '#dccdea',
  entry: '#e6dccb',
  balcony: '#cfe3c0',
  storage: '#dcd6cc',
  other: '#e2e2e2',
};
const MONO: Partial<Plan2DTheme> = {
  bg: '#ffffff',
  grid: '#f0f0f0',
  gridMajor: '#dedede',
  wall: '#111111',
  wallStroke: '#000000',
  floor: '#ffffff',
  text: '#111111',
  muted: '#444444',
  object: '#ffffff',
  opening: '#000000',
};
const COLOR: Partial<Plan2DTheme> = {
  bg: '#fbf8f3',
  grid: '#efe9df',
  gridMajor: '#e2d9cb',
  wall: '#3a3530',
  wallStroke: '#2a2622',
  floor: '#f3eee6',
  text: '#2a2622',
  muted: '#5c554d',
  object: '#ffffff',
  opening: '#8a5a2b',
};

type Preview = { level: Level; changed: Set<string>; invalid: boolean };
type Drag =
  | { kind: 'vertex'; wallId: string; end: 'a' | 'b'; preview: Preview | null }
  | { kind: 'wall'; wallId: string; start: Vec2; preview: Preview | null }
  | {
      kind: 'object';
      id: string;
      start: Vec2;
      orig: [number, number, number];
      pos: [number, number, number] | null;
    }
  | { kind: 'opening'; id: string; offset: number | null }
  | { kind: 'box'; start: Vec2; end: Vec2 }
  | { kind: 'rect'; start: Vec2; end: Vec2 }
  | { kind: 'annotation'; id: string; start: Vec2; delta: Vec2 }
  | { kind: 'pan'; start: Vec2; view: ViewTransform };

/** 物件拖曳的對齊參考線（世界座標；FE-PLAN-06 智慧參考線） */
type Guide = { axis: 'x' | 'z'; value: number; from: number; to: number };

const SNAP_PX = 10;

export function Plan2D({
  store,
  catalog,
  t,
  lengthUnit,
  areaUnit,
  onContextMenu,
  requestText,
  ghostLevel,
  snapSettings,
  planStyle = 'blueprint',
  underlay,
  heatmap,
  pins,
  onPinClick,
  theme: baseTheme,
}: Omit<Plan2DProps, 'theme'> & { theme: Plan2DTheme }) {
  const theme = useMemo(
    () =>
      planStyle === 'mono'
        ? { ...baseTheme, ...MONO }
        : planStyle === 'color'
          ? { ...baseTheme, ...COLOR }
          : baseTheme,
    [baseTheme, planStyle],
  );
  const underlayImg = useImage(underlay?.visible ? underlay.src : null);
  const scene = useStore(store, (s) => s.scene);
  const levelId = useStore(store, (s) => s.levelId);
  const selection = useStore(store, (s) => s.selection);
  const tool = useStore(store, (s) => s.tool);
  const placeId = useStore(store, (s) => s.placeCatalogId);
  const layers = useStore(store, (s) => s.layers);
  const snapEnabled = useStore(store, (s) => s.snapEnabled);
  const level = useMemo(() => activeLevel({ scene, levelId }), [scene, levelId]);

  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewTransform | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [snapInfo, setSnapInfo] = useState<SnapResult | null>(null);
  const [lenBuf, setLenBuf] = useState('');
  const [altDown, setAltDown] = useState(false);
  const [editDim, setEditDim] = useState<{ wallId: string; x: number; y: number; text: string } | null>(null);
  /** 測量工具的點（暫態，不入 Scene；FE-PLAN-09） */
  const [measure, setMeasure] = useState<{ pts: Vec2[]; closed: boolean; done: boolean }>({
    pts: [],
    closed: false,
    done: false,
  });
  /** 尺寸標註工具：a、b 兩點之後移動滑鼠決定偏移 */
  const [dimDraft, setDimDraft] = useState<Vec2[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const lastPointer = useRef<Vec2 | null>(null);
  const measureRef = useRef<Vec2[]>([]);
  measureRef.current = measure.pts;
  const v = view ?? fitView(null, size);

  // 容器尺寸
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) =>
        e && setSize({ w: Math.max(100, e.contentRect.width), h: Math.max(100, e.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts = level.walls
      .flatMap((w) => [w.a, w.b])
      .concat(level.objects.map((o) => [o.position[0], o.position[2]] as [number, number]));
    setView(fitView(bboxOf(pts), size));
  }, [level, size]);
  useEffect(() => {
    if (!view && size.w > 100) fit();
  }, [size, view, fit]);

  // 測試鉤子
  useEffect(() => {
    plan2dApi.set({
      worldToClient: (p) => {
        const r = wrap.current!.getBoundingClientRect();
        const s = worldToScreen(v, p);
        return [s[0] + r.left, s[1] + r.top];
      },
      clientToWorld: (p) => {
        const r = wrap.current!.getBoundingClientRect();
        return screenToWorld(v, [p[0] - r.left, p[1] - r.top]);
      },
      fit,
      pointerWorld: () => lastPointer.current,
      measurePoints: () => measureRef.current,
      snapshot: (maxSide = 640) => {
        const st = stageRef.current;
        if (!st) return null;
        return st.toDataURL({ pixelRatio: Math.min(1, maxSide / Math.max(st.width(), st.height())) });
      },
    });
    return () => plan2dApi.set(null);
  }, [v, fit]);

  // 切換工具時清除草稿
  useEffect(() => {
    setDraft([]);
    setLenBuf('');
    setHover(null);
    setMeasure({ pts: [], closed: false, done: false });
    setDimDraft([]);
  }, [tool]);
  const drafting = tool === 'wall' || tool === 'polygon';

  const tol = SNAP_PX / v.scale;
  const doSnap = useCallback(
    (p: Vec2, extra: Partial<Parameters<typeof snap>[1]> = {}) => {
      const r = snap(p, {
        level,
        tolerance: tol,
        gridMm: snapSettings?.gridMm ?? 100,
        angleStepRad: ((snapSettings?.angleDeg ?? 15) * Math.PI) / 180,
        ...(snapSettings?.targets ? { targets: snapSettings.targets } : {}),
        disabled: !snapEnabled || altDown,
        ...extra,
      });
      setSnapInfo(r);
      return r.point;
    },
    [level, tol, snapEnabled, altDown, snapSettings],
  );

  const pointer = (): Vec2 | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? screenToWorld(v, [p.x, p.y]) : null;
  };
  const exec = store.getState().exec;

  const finishDraft = useCallback(
    (closed = false) => {
      if (draft.length >= 2) exec(addWalls(levelId, draft, { closed }));
      setDraft([]);
      setLenBuf('');
    },
    [draft, exec, levelId],
  );

  // 畫牆鍵盤：數字輸入長度、Enter 完成、Esc 取消、Backspace 退一步
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setAltDown(e.altKey);
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (tool === 'measure' && (e.key === 'Escape' || e.key === 'Enter')) {
        setMeasure((m) =>
          e.key === 'Escape' ? { pts: [], closed: false, done: false } : { ...m, done: true },
        );
        e.preventDefault();
        return;
      }
      if (tool === 'dimension' && e.key === 'Escape') {
        setDimDraft([]);
        return;
      }
      if (!drafting || draft.length === 0) return;
      if (/^[0-9.]$/.test(e.key)) {
        setLenBuf((b) => b + e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        if (lenBuf) setLenBuf((b) => b.slice(0, -1));
        else setDraft((d) => d.slice(0, -1));
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const len = lenBuf ? parseLength(lenBuf, lengthUnit) : null;
        const last = draft[draft.length - 1]!;
        if (len && hover) {
          const dx = hover[0] - last[0];
          const dy = hover[1] - last[1];
          const l = Math.hypot(dx, dy) || 1;
          setDraft([...draft, [Math.round(last[0] + (dx / l) * len), Math.round(last[1] + (dy / l) * len)]]);
          setLenBuf('');
        } else finishDraft(tool === 'polygon');
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (draft.length >= 2) finishDraft(tool === 'polygon');
        else setDraft([]);
        setLenBuf('');
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => setAltDown(e.altKey);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp);
    };
  }, [tool, draft, lenBuf, hover, lengthUnit, finishDraft, drafting]);

  // 門窗懸停預覽
  const openingType = tool === 'door' ? 'door' : tool === 'window' ? 'window' : null;
  const openingCandidate = useMemo(() => {
    if (!openingType || !hover) return null;
    let best: { wallId: string; t: number; d: number } | null = null;
    for (const w of level.walls) {
      const c = closestOnSegment(hover, w.a as Vec2, w.b as Vec2);
      if (c.distance <= Math.max(tol * 2, w.thickness) && (!best || c.distance < best.d))
        best = { wallId: w.id, t: c.t, d: c.distance };
    }
    if (!best) return null;
    const w = level.walls.find((x) => x.id === best!.wallId)!;
    const len = wallLength(w);
    // 從資產庫選的門窗樣式：尺寸、窗台、樣式取自目錄參數
    const entry = placeId ? catalog.get(placeId) : undefined;
    const pr = entry ? resolveParams(entry) : {};
    const num = (k: string, d: number) => (typeof pr[k] === 'number' ? (pr[k] as number) : d);
    const style = typeof pr.style === 'string' ? (pr.style as OpeningStyle) : undefined;
    const width = num('w', openingType === 'door' ? DEFAULTS.doorWidth : DEFAULTS.windowWidth);
    if (len < width) return { invalid: true, o: null };
    const offset = Math.round(Math.min(len - width, Math.max(0, best.t * len - width / 2)));
    const o: Opening =
      openingType === 'door'
        ? {
            id: 'preview',
            wallId: w.id,
            type: 'door',
            offset,
            width,
            height: num('h', DEFAULTS.doorHeight),
            sill: 0,
            swing:
              pr.swing === 'right'
                ? 'right'
                : pr.swing === 'double'
                  ? 'double'
                  : style === 'sliding'
                    ? 'sliding'
                    : 'left',
            ...(style ? { style } : {}),
          }
        : {
            id: 'preview',
            wallId: w.id,
            type: 'window',
            offset,
            width,
            height: num('h', DEFAULTS.windowHeight),
            sill: num('sill', DEFAULTS.windowSill),
            ...(style ? { style } : {}),
          };
    const clash = level.openings.some(
      (x) => x.wallId === w.id && x.offset < offset + width && offset < x.offset + x.width,
    );
    return { invalid: clash, o };
  }, [openingType, hover, level, tol, placeId, catalog]);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current!.getPointerPosition()!;
    setView(zoomAt(v, [p.x, p.y], e.evt.deltaY < 0 ? 1.12 : 1 / 1.12));
  };

  const hitInfo = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const n = e.target;
    return { name: n.name(), id: n.id() };
  };

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const p = pointer();
    if (!p) return;
    const sp = stageRef.current!.getPointerPosition()!;
    if (e.evt.button === 1 || tool === 'pan' || (e.evt.button === 0 && e.evt.getModifierState?.(' '))) {
      setDrag({ kind: 'pan', start: [sp.x, sp.y], view: v });
      return;
    }
    if (e.evt.button !== 0) return;
    const { name, id } = hitInfo(e);
    const s = store.getState();
    if (tool === 'measure') {
      const q = doSnap(p);
      setMeasure((m) => {
        if (m.done) return { pts: [q], closed: false, done: false };
        if (m.pts.length >= 3 && Math.hypot(q[0] - m.pts[0]![0], q[1] - m.pts[0]![1]) <= tol)
          return { ...m, closed: true, done: true };
        if (e.evt.detail >= 2) return { ...m, done: true };
        return { ...m, pts: [...m.pts, q] };
      });
      return;
    }
    if (tool === 'dimension') {
      const q = doSnap(p);
      if (dimDraft.length < 2) setDimDraft([...dimDraft, q]);
      else {
        const [a, b] = dimDraft as [Vec2, Vec2];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const off = ((q[0] - a[0]) * -(b[1] - a[1]) + (q[1] - a[1]) * (b[0] - a[0])) / L;
        exec(addAnnotation(levelId, { type: 'dimension', data: { a, b, offset: Math.round(off) } }));
        setDimDraft([]);
      }
      return;
    }
    if (tool === 'text') {
      const q = doSnap(p);
      void (requestText?.('') ?? Promise.resolve(window.prompt(t('tools.textPrompt')) ?? null)).then(
        (text) => {
          if (text && text.trim())
            exec(
              addAnnotation(levelId, { type: 'text', data: { position: q, text: text.trim(), size: 250 } }),
            );
        },
      );
      return;
    }
    if (drafting) {
      const q = doSnap(p, { angleFrom: draft[draft.length - 1] });
      if (draft.length >= 3 && Math.hypot(q[0] - draft[0]![0], q[1] - draft[0]![1]) <= tol)
        return finishDraft(true);
      if (e.evt.detail >= 2 && draft.length >= 2) return finishDraft(tool === 'polygon');
      const last = draft[draft.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) setDraft([...draft, q]);
      return;
    }
    if (tool === 'rect') {
      const q = doSnap(p);
      setDrag({ kind: 'rect', start: q, end: q });
      return;
    }
    if (openingType) {
      if (openingCandidate?.o && !openingCandidate.invalid) {
        const { id: _i, ...o } = openingCandidate.o;
        exec(addOpening(levelId, o));
      } else s.notify('warn', t('hint.openingNeedsWall'));
      return;
    }
    if (tool === 'place' && placeId) {
      const entry = catalog.get(placeId);
      if (!entry) return;
      const q = doSnap(p);
      const y = defaultElevation(entry, level.height);
      const before = new Set(level.objects.map((o) => o.id));
      if (exec(addObject(levelId, { catalogId: entry.id, position: [q[0], y, q[1]], rotationY: 0 }))) {
        const added = activeLevel(store.getState()).objects.find((o) => !before.has(o.id));
        if (added) s.select([added.id]);
      }
      s.setTool('select');
      return;
    }
    // 油漆模式（FE-V3D-05 的 2D 對應）：點房間＝地板、點牆＝兩面、點家具＝主材質；Alt＝滴管
    if (tool === 'paint') {
      const lv = level;
      if (e.evt.altKey) {
        const w = lv.walls.find((x) => x.id === id);
        const r = lv.rooms.find((x) => x.id === id);
        const o = lv.objects.find((x) => x.id === id);
        const slot = o && catalog.get(o.catalogId)?.materialSlots[0];
        const m =
          w?.materialId ??
          r?.floorMaterialId ??
          (slot ? (o!.materialOverrides?.[slot.name] ?? slot.defaultMaterialId) : undefined);
        if (m) s.setTool('paint', m);
        return;
      }
      if (!placeId) return;
      if (name === 'wall') exec(setMaterial(levelId, { kind: 'wall', id, side: 'both' }, placeId));
      else if (name === 'room') exec(setMaterial(levelId, { kind: 'floor', roomId: id }, placeId));
      else if (name === 'object') {
        const o = lv.objects.find((x) => x.id === id);
        const slot = o && catalog.get(o.catalogId)?.materialSlots[0]?.name;
        if (slot) exec(setMaterial(levelId, { kind: 'object', id, slot }, placeId));
      }
      return;
    }
    // select 工具
    if (name === 'vertex') {
      const [wallId, end] = id.split(':') as [string, 'a' | 'b'];
      setDrag({ kind: 'vertex', wallId, end, preview: null });
      return;
    }
    if (name === 'object' || name === 'wall' || name === 'opening') {
      const additive = e.evt.shiftKey;
      if (!s.selection.includes(id) || additive) s.select([id], additive);
      if (additive) return;
      if (name === 'object') {
        const o = level.objects.find((x) => x.id === id)!;
        if (!o.locked) setDrag({ kind: 'object', id, start: p, orig: [...o.position], pos: null });
      } else if (name === 'wall') setDrag({ kind: 'wall', wallId: id, start: p, preview: null });
      else setDrag({ kind: 'opening', id, offset: null });
      return;
    }
    if (name === 'annotation') {
      if (!s.selection.includes(id) || e.evt.shiftKey) s.select([id], e.evt.shiftKey);
      if (!e.evt.shiftKey) setDrag({ kind: 'annotation', id, start: p, delta: [0, 0] });
      return;
    }
    if (name === 'room') {
      s.select([id], e.evt.shiftKey);
      return;
    }
    if (!e.evt.shiftKey) s.select([]);
    setDrag({ kind: 'box', start: p, end: p });
  };

  const onMove = () => {
    const p = pointer();
    if (!p) return;
    lastPointer.current = p;
    if (!drag) {
      if (drafting) setHover(doSnap(p, { angleFrom: draft[draft.length - 1] }));
      else if (tool === 'place' || tool === 'rect' || tool === 'measure' || tool === 'dimension')
        setHover(doSnap(p));
      else setHover(p);
      return;
    }
    switch (drag.kind) {
      case 'pan': {
        const sp = stageRef.current!.getPointerPosition()!;
        setView({
          ...drag.view,
          ox: drag.view.ox + sp.x - drag.start[0],
          oy: drag.view.oy + sp.y - drag.start[1],
        });
        break;
      }
      case 'vertex': {
        const q = doSnap(p, {
          excludeWallIds: level.walls
            .filter((w) => sharesEnd(level, drag.wallId, drag.end, w.id))
            .map((w) => w.id),
        });
        const r = geoMove(level, { wallId: drag.wallId, end: drag.end }, q);
        const changed = new Set(
          level.walls.filter((w) => sharesEnd(level, drag.wallId, drag.end, w.id)).map((w) => w.id),
        );
        if (r.violations.length) {
          const forced = forceMove(level, changed, drag, q);
          setDrag({ ...drag, preview: { level: forced, changed, invalid: true } });
        } else
          setDrag({
            ...drag,
            preview: { level: r.level, changed: new Set(r.changedWallIds), invalid: false },
          });
        break;
      }
      case 'wall': {
        const d: Vec2 = [Math.round(p[0] - drag.start[0]), Math.round(p[1] - drag.start[1])];
        const g = snapEnabled && !altDown ? 50 : 1;
        const dd: Vec2 = [Math.round(d[0] / g) * g, Math.round(d[1] / g) * g];
        let cur = level;
        let invalid = false;
        const w0 = level.walls.find((w) => w.id === drag.wallId)!;
        for (const end of ['a', 'b'] as const) {
          const src = w0[end] as Vec2;
          const r = geoMove(cur, { wallId: drag.wallId, end }, [src[0] + dd[0], src[1] + dd[1]]);
          if (r.violations.length) invalid = true;
          else cur = r.level;
        }
        const changed = new Set(
          level.walls
            .filter(
              (w) =>
                w.id === drag.wallId ||
                sharesEnd(level, drag.wallId, 'a', w.id) ||
                sharesEnd(level, drag.wallId, 'b', w.id),
            )
            .map((w) => w.id),
        );
        setDrag({ ...drag, preview: { level: cur, changed, invalid } });
        break;
      }
      case 'object': {
        let q = doSnap([drag.orig[0] + p[0] - drag.start[0], drag.orig[2] + p[1] - drag.start[1]], {
          excludeWallIds: [],
        });
        // 智慧參考線：與其他物件的中心／邊緣對齊（容差 8 px）
        const g: Guide[] = [];
        if (snapEnabled && !altDown) {
          const o = level.objects.find((x) => x.id === drag.id)!;
          const me = footprintOf({ ...o, position: [q[0], o.position[1], q[1]] }, catalog);
          const mx = me.map((pp) => pp[0]);
          const mz = me.map((pp) => pp[1]);
          const mine = {
            x: [Math.min(...mx), q[0], Math.max(...mx)],
            z: [Math.min(...mz), q[1], Math.max(...mz)],
          };
          let bx: { d: number; v: number; o: Vec2 } | null = null;
          let bz: { d: number; v: number; o: Vec2 } | null = null;
          for (const other of level.objects) {
            if (other.id === drag.id || other.appearance?.hidden) continue;
            const fp = footprintOf(other, catalog);
            const xs = fp.map((pp) => pp[0]);
            const zs = fp.map((pp) => pp[1]);
            const tx = [Math.min(...xs), other.position[0], Math.max(...xs)];
            const tz = [Math.min(...zs), other.position[2], Math.max(...zs)];
            for (const a of mine.x)
              for (const b of tx) {
                const d = Math.abs(a - b);
                if (d <= 8 / v.scale && (!bx || d < bx.d)) bx = { d, v: b - a, o: [b, other.position[2]] };
              }
            for (const a of mine.z)
              for (const b of tz) {
                const d = Math.abs(a - b);
                if (d <= 8 / v.scale && (!bz || d < bz.d)) bz = { d, v: b - a, o: [other.position[0], b] };
              }
          }
          if (bx) {
            q = [Math.round(q[0] + bx.v), q[1]];
            const x = bx.o[0];
            g.push({
              axis: 'x',
              value: x,
              from: Math.min(q[1], bx.o[1]) - 300,
              to: Math.max(q[1], bx.o[1]) + 300,
            });
          }
          if (bz) {
            q = [q[0], Math.round(q[1] + bz.v)];
            const z = bz.o[1];
            g.push({
              axis: 'z',
              value: z,
              from: Math.min(q[0], bz.o[0]) - 300,
              to: Math.max(q[0], bz.o[0]) + 300,
            });
          }
        }
        setGuides(g);
        setDrag({ ...drag, pos: [q[0], drag.orig[1], q[1]] });
        break;
      }
      case 'annotation':
        setDrag({ ...drag, delta: [Math.round(p[0] - drag.start[0]), Math.round(p[1] - drag.start[1])] });
        break;
      case 'opening': {
        const o = level.openings.find((x) => x.id === drag.id)!;
        const w = level.walls.find((x) => x.id === o.wallId)!;
        const c = closestOnSegment(p, w.a as Vec2, w.b as Vec2);
        const len = wallLength(w);
        const g = snapEnabled && !altDown ? 50 : 1;
        const off = Math.round(Math.min(len - o.width, Math.max(0, c.t * len - o.width / 2)) / g) * g;
        setDrag({ ...drag, offset: off });
        break;
      }
      case 'box':
        setDrag({ ...drag, end: p });
        break;
      case 'rect':
        setDrag({ ...drag, end: doSnap(p) });
        break;
    }
  };

  const onUp = () => {
    if (!drag) return;
    const s = store.getState();
    switch (drag.kind) {
      case 'vertex':
        if (drag.preview) {
          const w = drag.preview.level.walls.find((x) => x.id === drag.wallId)!;
          exec(moveWallVertex(levelId, { wallId: drag.wallId, end: drag.end }, w[drag.end] as Vec2));
        }
        break;
      case 'wall':
        if (drag.preview) {
          const a = level.walls.find((x) => x.id === drag.wallId)!.a;
          const b = drag.preview.level.walls.find((x) => x.id === drag.wallId)!.a;
          if (a[0] !== b[0] || a[1] !== b[1])
            exec(translateWall(levelId, drag.wallId, [b[0] - a[0], b[1] - a[1]]));
        }
        break;
      case 'object':
        if (drag.pos && (drag.pos[0] !== drag.orig[0] || drag.pos[2] !== drag.orig[2])) {
          // 群組（FE-PLAN-07）或多選：一起移動
          const o = level.objects.find((x) => x.id === drag.id)!;
          const dx = drag.pos[0] - drag.orig[0];
          const dz = drag.pos[2] - drag.orig[2];
          const mates = level.objects.filter(
            (x) =>
              x.id !== o.id &&
              !x.locked &&
              ((o.groupId && x.groupId === o.groupId) ||
                (s.selection.includes(x.id) && s.selection.includes(o.id))),
          );
          exec(
            batch(
              [
                transformObject(levelId, drag.id, {
                  // 疊放吸附（FE-V3D-04）：落在桌面／櫃面上時自動抬高
                  position: [
                    drag.pos[0],
                    stackElevation(level, catalog, o, [drag.pos[0], drag.pos[2]], o.rotationY) ?? drag.pos[1],
                    drag.pos[2],
                  ],
                }),
                ...mates.map((m) =>
                  transformObject(levelId, m.id, {
                    position: [m.position[0] + dx, m.position[1], m.position[2] + dz],
                  }),
                ),
              ],
              'command.transformObject',
            ),
          );
        }
        setGuides([]);
        break;
      case 'annotation': {
        const a = level.annotations?.find((x) => x.id === drag.id);
        if (a && (drag.delta[0] || drag.delta[1]))
          exec(updateAnnotation(levelId, a.id, moveAnnotation(a.data ?? {}, drag.delta)));
        break;
      }
      case 'opening':
        if (drag.offset !== null) exec(updateOpening(levelId, drag.id, { offset: drag.offset }));
        break;
      case 'box': {
        const x0 = Math.min(drag.start[0], drag.end[0]);
        const x1 = Math.max(drag.start[0], drag.end[0]);
        const y0 = Math.min(drag.start[1], drag.end[1]);
        const y1 = Math.max(drag.start[1], drag.end[1]);
        if (x1 - x0 > tol && y1 - y0 > tol) {
          const inside = (pts: readonly (readonly number[])[]) =>
            pts.every((q) => q[0]! >= x0 && q[0]! <= x1 && q[1]! >= y0 && q[1]! <= y1);
          const ids = [
            ...level.walls.filter((w) => inside([w.a, w.b])).map((w) => w.id),
            ...level.objects.filter((o) => inside(footprintOf(o, catalog))).map((o) => o.id),
            ...(level.annotations ?? [])
              .filter((a) => inside(annotationPoints(a.data ?? {})))
              .map((a) => a.id),
          ];
          s.select(ids, true);
        }
        break;
      }
      case 'rect':
        if (Math.abs(drag.end[0] - drag.start[0]) >= 300 && Math.abs(drag.end[1] - drag.start[1]) >= 300)
          exec(addRectRoom(levelId, drag.start, drag.end));
        break;
      case 'pan':
        break;
    }
    setDrag(null);
  };

  // 衍生資料
  const detected = useMemo(() => detectRooms(level), [level]);
  const collisions = useMemo(() => {
    return new Set(findCollisions(level, collisionInputs(level, catalog)).map((c) => c.objectId));
  }, [level, catalog]);
  const hidden = useMemo(() => {
    if (!drag) return EMPTY;
    if ((drag.kind === 'vertex' || drag.kind === 'wall') && drag.preview) return drag.preview.changed;
    if (drag.kind === 'object' && drag.pos) return new Set([drag.id]);
    if (drag.kind === 'opening' && drag.offset !== null) return new Set([drag.id]);
    return EMPTY;
  }, [drag]);
  const selSet = useMemo(() => new Set(selection), [selection]);
  const px = 1 / v.scale; // 1 螢幕像素對應的 mm

  const previewLevel = drag && (drag.kind === 'vertex' || drag.kind === 'wall') ? drag.preview : null;
  const dimLevel = previewLevel?.level ?? level;

  // 觸控（FE-MOB-01）：兩指縮放／平移（攔在 Konva 之前）、長按＝右鍵選單
  const touches = useRef(new Map<number, Vec2>());
  const gesture = useRef<{ d: number; mid: Vec2; view: ViewTransform } | null>(null);
  const longPress = useRef<{ timer: number; at: Vec2 } | null>(null);
  const localPt = (e: React.PointerEvent): Vec2 => {
    const r = wrap.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pinch = () => {
    const [a, b] = [...touches.current.values()] as [Vec2, Vec2];
    return {
      d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2,
    };
  };
  const clearLong = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };
  const touchHandlers = {
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, localPt(e));
      if (touches.current.size === 1) {
        const at = localPt(e);
        const cx = e.clientX;
        const cy = e.clientY;
        longPress.current = {
          at,
          timer: window.setTimeout(() => {
            longPress.current = null;
            if (!onContextMenu || touches.current.size !== 1) return;
            const n = stageRef.current?.getIntersection({ x: at[0], y: at[1] });
            const name = n?.name() ?? '';
            const hit = ['wall', 'object', 'opening', 'room', 'annotation'].includes(name) ? n!.id() : null;
            if (hit && !store.getState().selection.includes(hit)) store.getState().select([hit]);
            setDrag(null);
            onContextMenu({ clientX: cx, clientY: cy, hit, world: screenToWorld(v, at) });
          }, 550),
        };
      }
      if (touches.current.size === 2) {
        clearLong();
        setDrag(null);
        const { d, mid } = pinch();
        gesture.current = { d, mid, view: v };
        e.stopPropagation();
      }
    },
    onPointerMoveCapture: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, localPt(e));
      if (longPress.current) {
        const p = localPt(e);
        if (Math.hypot(p[0] - longPress.current.at[0], p[1] - longPress.current.at[1]) > 8) clearLong();
      }
      const g = gesture.current;
      if (g && touches.current.size >= 2) {
        const { d, mid } = pinch();
        const moved: ViewTransform = {
          ...g.view,
          ox: g.view.ox + mid[0] - g.mid[0],
          oy: g.view.oy + mid[1] - g.mid[1],
        };
        setView(zoomAt(moved, mid, d / g.d));
        e.stopPropagation();
      }
    },
    onPointerUpCapture: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.delete(e.pointerId);
      clearLong();
      if (gesture.current) {
        if (touches.current.size < 2) gesture.current = null;
        e.stopPropagation();
      }
    },
  };

  return (
    <div
      ref={wrap}
      className="relative h-full w-full overflow-hidden"
      style={{
        background: theme.bg,
        cursor: tool === 'select' ? 'default' : 'crosshair',
        touchAction: 'none',
      }}
      data-testid="plan2d"
      {...touchHandlers}
      onPointerCancelCapture={touchHandlers.onPointerUpCapture}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          const p = pointer();
          if (!p || !onContextMenu) return;
          const n = e.target;
          const name = n.name();
          const hit = ['wall', 'object', 'opening', 'room', 'annotation'].includes(name) ? n.id() : null;
          if (hit && !store.getState().selection.includes(hit)) store.getState().select([hit]);
          onContextMenu({ clientX: e.evt.clientX, clientY: e.evt.clientY, hit, world: p });
        }}
      >
        <Layer listening={false}>
          {snapSettings?.showGrid !== false && <Grid v={v} size={size} theme={theme} />}
          {underlay?.visible && underlayImg && (
            <Group x={v.ox} y={v.oy} scaleX={v.scale} scaleY={v.scale}>
              <KImage
                image={underlayImg}
                x={underlay.x}
                y={underlay.z}
                width={underlay.widthMm}
                height={(underlay.widthMm * underlayImg.height) / Math.max(1, underlayImg.width)}
                rotation={underlay.rotationDeg}
                opacity={underlay.opacity}
              />
            </Group>
          )}
        </Layer>
        {ghostLevel && (
          <Layer listening={false} opacity={0.22}>
            <Group x={v.ox} y={v.oy} scaleX={v.scale} scaleY={v.scale}>
              {ghostLevel.walls.map((w) => (
                <Line key={w.id} points={flat(wallQuad(ghostLevel.walls, w))} closed fill={theme.wall} />
              ))}
            </Group>
          </Layer>
        )}
        <Layer>
          <Group x={v.ox} y={v.oy} scaleX={v.scale} scaleY={v.scale}>
            <StaticPlan
              level={level}
              hidden={hidden}
              sel={selSet}
              layers={layers}
              catalog={catalog}
              theme={theme}
              px={px}
              roomsDetected={detected.rooms}
              collisions={collisions}
              t={t}
              areaUnit={areaUnit}
              roomFill={planStyle === 'color' ? (k) => ROOM_KIND_FILL[k ?? 'other'] : undefined}
            />
            {heatmap && (
              <Shape
                listening={false}
                opacity={0.62}
                perfectDrawEnabled={false}
                sceneFunc={(ctx) => {
                  const h = heatmap.step / 2;
                  for (const c of heatmap.cells) {
                    ctx.fillStyle = c.color;
                    ctx.fillRect(c.x - h, c.z - h, heatmap.step, heatmap.step);
                  }
                }}
              />
            )}
          </Group>
        </Layer>
        {pins && pins.length > 0 && (
          <Layer>
            {pins.map((p) => {
              const [sx, sy] = worldToScreen(v, [p.x, p.z]);
              return (
                <Group
                  key={p.id}
                  x={sx}
                  y={sy}
                  onPointerDown={(e) => {
                    e.cancelBubble = true;
                    onPinClick?.(p.id);
                  }}
                  opacity={p.resolved ? 0.45 : 1}
                >
                  <Line
                    points={[0, 0, -11, -16, -11, -30, 11, -30, 11, -16]}
                    closed
                    fill={p.active ? theme.primary : '#ff6b5e'}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                  <Text
                    text={p.label}
                    x={-11}
                    y={-27}
                    width={22}
                    align="center"
                    fontSize={11}
                    fontStyle="bold"
                    fill="#fff"
                    listening={false}
                  />
                </Group>
              );
            })}
          </Layer>
        )}
        {/* drag/preview layer（ADR-010：拖曳時只重畫這一層） */}
        <Layer listening={tool === 'select'}>
          <Group x={v.ox} y={v.oy} scaleX={v.scale} scaleY={v.scale}>
            {previewLevel &&
              previewLevel.level.walls
                .filter((w) => previewLevel.changed.has(w.id))
                .map((w) => (
                  <Line
                    key={w.id}
                    points={flat(wallQuad(previewLevel.level.walls, w))}
                    closed
                    fill={previewLevel.invalid ? theme.danger : theme.primary}
                    opacity={0.75}
                    listening={false}
                  />
                ))}
            {previewLevel &&
              previewLevel.level.openings
                .filter((o) => previewLevel.changed.has(o.wallId))
                .map((o) => (
                  <OpeningShape
                    key={o.id}
                    level={previewLevel.level}
                    o={o}
                    theme={theme}
                    px={px}
                    selected={false}
                  />
                ))}
            {drag?.kind === 'object' &&
              drag.pos &&
              (() => {
                const o = level.objects.find((x) => x.id === drag.id)!;
                return (
                  <Line
                    points={flat(footprintOf({ ...o, position: drag.pos }, catalog))}
                    closed
                    fill={theme.object}
                    stroke={theme.primary}
                    strokeWidth={2}
                    strokeScaleEnabled={false}
                    opacity={0.85}
                    listening={false}
                  />
                );
              })()}
            {drag?.kind === 'opening' &&
              drag.offset !== null &&
              (() => {
                const o = level.openings.find((x) => x.id === drag.id)!;
                return (
                  <OpeningShape
                    level={level}
                    o={{ ...o, offset: drag.offset }}
                    theme={theme}
                    px={px}
                    selected
                  />
                );
              })()}
            {tool === 'select' &&
              selection.flatMap((id) => {
                const w = dimLevel.walls.find((x) => x.id === id);
                return w
                  ? (['a', 'b'] as const).map((end) => (
                      <Circle
                        key={`${id}:${end}`}
                        id={`${id}:${end}`}
                        name="vertex"
                        x={w[end][0]}
                        y={w[end][1]}
                        radius={6 * px}
                        fill={theme.bg}
                        stroke={theme.primary}
                        strokeWidth={2}
                        strokeScaleEnabled={false}
                        hitStrokeWidth={12}
                      />
                    ))
                  : [];
              })}
            {drafting && draft.length > 0 && (
              <>
                <Line
                  points={flat(hover ? [...draft, hover] : draft)}
                  stroke={theme.primary}
                  strokeWidth={DEFAULTS.wallThickness}
                  opacity={0.35}
                  lineCap="square"
                  lineJoin="miter"
                  listening={false}
                />
                <Line
                  points={flat(
                    hover
                      ? [...draft, hover, ...(tool === 'polygon' && draft.length >= 2 ? [draft[0]!] : [])]
                      : draft,
                  )}
                  stroke={theme.primary}
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  dash={[6, 4]}
                  listening={false}
                />
                {hover &&
                  (() => {
                    const last = draft[draft.length - 1]!;
                    const len = Math.hypot(hover[0] - last[0], hover[1] - last[1]);
                    return (
                      <Text
                        x={(last[0] + hover[0]) / 2}
                        y={(last[1] + hover[1]) / 2 - 22 * px}
                        text={lenBuf ? `${lenBuf}▍` : formatLength(len, lengthUnit)}
                        fontSize={13 * px}
                        fill={theme.primary}
                        listening={false}
                      />
                    );
                  })()}
              </>
            )}
            {openingCandidate?.o && (
              <OpeningShape
                level={level}
                o={openingCandidate.o}
                theme={{ ...theme, opening: openingCandidate.invalid ? theme.danger : theme.primary }}
                px={px}
                selected
              />
            )}
            {tool === 'place' &&
              hover &&
              placeId &&
              catalog.get(placeId) &&
              (() => {
                const d = objectDims(catalog.get(placeId)!);
                return (
                  <Rect
                    x={hover[0] - d.w / 2}
                    y={hover[1] - d.d / 2}
                    width={d.w}
                    height={d.d}
                    fill={theme.object}
                    opacity={0.5}
                    stroke={theme.primary}
                    strokeWidth={1.5}
                    strokeScaleEnabled={false}
                    dash={[6, 4]}
                    listening={false}
                  />
                );
              })()}
            {drag?.kind === 'box' && (
              <Rect
                x={Math.min(drag.start[0], drag.end[0])}
                y={Math.min(drag.start[1], drag.end[1])}
                width={Math.abs(drag.end[0] - drag.start[0])}
                height={Math.abs(drag.end[1] - drag.start[1])}
                stroke={theme.primary}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4, 4]}
                fill={theme.primary}
                opacity={0.08}
                listening={false}
              />
            )}
            {drag?.kind === 'rect' && (
              <Rect
                x={Math.min(drag.start[0], drag.end[0])}
                y={Math.min(drag.start[1], drag.end[1])}
                width={Math.abs(drag.end[0] - drag.start[0])}
                height={Math.abs(drag.end[1] - drag.start[1])}
                stroke={theme.primary}
                strokeWidth={DEFAULTS.wallThickness}
                opacity={0.4}
                listening={false}
              />
            )}
            {guides.map((g, i) => (
              <Line
                key={`g${i}`}
                points={g.axis === 'x' ? [g.value, g.from, g.value, g.to] : [g.from, g.value, g.to, g.value]}
                stroke={theme.warn}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[6, 4]}
                listening={false}
              />
            ))}
            {drag?.kind === 'annotation' &&
              (() => {
                const a = level.annotations?.find((x) => x.id === drag.id);
                return a ? (
                  <AnnotationShape
                    a={{ ...a, data: moveAnnotation(a.data ?? {}, drag.delta) }}
                    px={px}
                    unit={lengthUnit}
                    theme={theme}
                    selected
                  />
                ) : null;
              })()}
            {tool === 'measure' && measure.pts.length > 0 && (
              <MeasureShape
                pts={!measure.done && hover ? [...measure.pts, hover] : measure.pts}
                closed={measure.closed}
                px={px}
                unit={lengthUnit}
                areaUnit={areaUnit}
                theme={theme}
                t={t}
              />
            )}
            {tool === 'dimension' && dimDraft.length > 0 && hover && (
              <AnnotationShape
                a={{
                  id: 'preview',
                  type: 'dimension',
                  data:
                    dimDraft.length === 1
                      ? { a: dimDraft[0], b: hover, offset: 0 }
                      : (() => {
                          const [a, b] = dimDraft as [Vec2, Vec2];
                          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                          return {
                            a,
                            b,
                            offset:
                              ((hover[0] - a[0]) * -(b[1] - a[1]) + (hover[1] - a[1]) * (b[0] - a[0])) / L,
                          };
                        })(),
                }}
                px={px}
                unit={lengthUnit}
                theme={theme}
                selected
              />
            )}
            {snapInfo && snapInfo.kind !== 'none' && (tool !== 'select' || drag) && (
              <Circle
                x={snapInfo.point[0]}
                y={snapInfo.point[1]}
                radius={5 * px}
                stroke={snapInfo.kind === 'endpoint' ? theme.primary : theme.muted}
                strokeWidth={2}
                strokeScaleEnabled={false}
                listening={false}
              />
            )}
          </Group>
        </Layer>
        {layers.annotation && (
          <Layer>
            <Group x={v.ox} y={v.oy} scaleX={v.scale} scaleY={v.scale}>
              {(level.annotations ?? [])
                .filter((a) => !(drag?.kind === 'annotation' && drag.id === a.id))
                .map((a) => (
                  <AnnotationShape
                    key={a.id}
                    a={a}
                    px={px}
                    unit={lengthUnit}
                    theme={theme}
                    selected={selSet.has(a.id)}
                  />
                ))}
              <Dimensions
                level={dimLevel}
                px={px}
                unit={lengthUnit}
                theme={theme}
                onEdit={(wallId, x, y, text) => {
                  const s = worldToScreen(v, [x, y]);
                  setEditDim({ wallId, x: s[0], y: s[1], text });
                }}
              />
            </Group>
          </Layer>
        )}
      </Stage>
      {editDim && (
        <input
          autoFocus
          aria-label={t('inspector.length')}
          data-testid="dim-input"
          className="absolute rounded border px-1 text-xs font-mono"
          style={{
            left: editDim.x - 40,
            top: editDim.y - 12,
            width: 80,
            background: theme.bg,
            color: theme.text,
            borderColor: theme.primary,
          }}
          defaultValue={editDim.text}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const mm = parseLength((e.target as HTMLInputElement).value, lengthUnit);
              if (mm) exec(resizeWall(levelId, editDim.wallId, mm, 'start'));
              else store.getState().notify('warn', t('hint.badLength'));
              setEditDim(null);
            } else if (e.key === 'Escape') setEditDim(null);
            e.stopPropagation();
          }}
          onBlur={() => setEditDim(null)}
        />
      )}
      <div
        className="pointer-events-none absolute right-2 bottom-2 rounded px-2 py-1 font-mono text-xs"
        style={{ background: theme.bg, color: theme.muted }}
        data-testid="snap-status"
      >
        {t(`snap.${snapEnabled && !altDown ? (snapInfo?.kind ?? 'none') : 'off'}`)}
        {drafting && ` · ${t(tool === 'polygon' ? 'hint.polygonTool' : 'hint.wallTool')}`}
        {tool === 'measure' && ` · ${t('hint.measureTool')}`}
        {tool === 'dimension' && ` · ${t('hint.dimensionTool')}`}
      </div>
    </div>
  );
}

const EMPTY = new Set<string>();

function sharesEnd(level: Level, wallId: string, end: 'a' | 'b', otherId: string): boolean {
  const w = level.walls.find((x) => x.id === wallId);
  const o = level.walls.find((x) => x.id === otherId);
  if (!w || !o) return false;
  const p = w[end];
  return otherId === wallId || (o.a[0] === p[0] && o.a[1] === p[1]) || (o.b[0] === p[0] && o.b[1] === p[1]);
}

/** 違反約束時仍顯示「會變成怎樣」（紅色），但不提交 */
function forceMove(
  level: Level,
  changed: Set<string>,
  d: { wallId: string; end: 'a' | 'b' },
  q: Vec2,
): Level {
  const p = level.walls.find((w) => w.id === d.wallId)![d.end];
  return {
    ...level,
    walls: level.walls.map((w) =>
      !changed.has(w.id)
        ? w
        : {
            ...w,
            a: w.a[0] === p[0] && w.a[1] === p[1] ? [q[0], q[1]] : w.a,
            b: w.b[0] === p[0] && w.b[1] === p[1] ? [q[0], q[1]] : w.b,
          },
    ),
  };
}

const Grid = memo(function Grid({
  v,
  size,
  theme,
}: {
  v: ViewTransform;
  size: { w: number; h: number };
  theme: Plan2DTheme;
}) {
  return (
    <Shape
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        const step = gridStep(v.scale);
        const major = step * 10;
        const [x0, y0] = screenToWorld(v, [0, 0]);
        const [x1, y1] = screenToWorld(v, [size.w, size.h]);
        for (const [s, color] of [
          [step, theme.grid],
          [major, theme.gridMajor],
        ] as const) {
          ctx.beginPath();
          for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) {
            const sx = Math.round(x * v.scale + v.ox) + 0.5;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, size.h);
          }
          for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) {
            const sy = Math.round(y * v.scale + v.oy) + 0.5;
            ctx.moveTo(0, sy);
            ctx.lineTo(size.w, sy);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }}
    />
  );
});

interface StaticProps {
  level: Level;
  hidden: Set<string>;
  sel: Set<string>;
  layers: { structure: boolean; furniture: boolean; annotation: boolean };
  catalog: Catalog;
  theme: Plan2DTheme;
  px: number;
  roomsDetected: ReturnType<typeof detectRooms>['rooms'];
  collisions: Set<string>;
  t: Plan2DProps['t'];
  areaUnit: AreaUnit;
  roomFill?: ((kind: string | undefined) => string | undefined) | undefined;
}

/** 靜態圖層：拖曳期間 props 不變 → 不重畫（ADR-010） */
const StaticPlan = memo(function StaticPlan({
  level,
  hidden,
  sel,
  layers,
  catalog,
  theme,
  px,
  roomsDetected,
  collisions,
  t,
  areaUnit,
  roomFill,
}: StaticProps) {
  const outline = useMemo(
    () => wallOutline({ walls: level.walls.filter((w) => !hidden.has(w.id)) }),
    [level, hidden],
  );
  const roomByKey = new Map(level.rooms.map((r) => [[...r.wallIds].sort().join('|'), r]));
  return (
    <>
      {layers.structure &&
        roomsDetected.map((d) => {
          const r = roomByKey.get(d.key);
          const c = centroid(d.floor.length ? d.floor : d.centerline);
          const selected = !!r && sel.has(r.id);
          return (
            <Group key={d.key}>
              <Line
                id={r?.id}
                name={r ? 'room' : undefined}
                points={flat(d.floor)}
                closed
                fill={
                  selected
                    ? theme.primary
                    : ((roomFill && roomFill(r ? inferRoomKind(r, d.netArea / 1e6, false) : undefined)) ??
                      theme.floor)
                }
                opacity={selected ? 0.18 : 1}
                perfectDrawEnabled={false}
              />
              <Text
                x={c[0]}
                y={c[1]}
                offsetX={60 * px}
                text={`${r?.label || t('room.unnamed')}\n${formatArea(d.netArea, areaUnit)}`}
                fontSize={12 * px}
                width={120 * px}
                align="center"
                fill={theme.muted}
                listening={false}
              />
            </Group>
          );
        })}
      {layers.structure &&
        level.walls
          .filter((w) => !hidden.has(w.id))
          .map((w) => (
            <Line
              key={w.id}
              id={w.id}
              name="wall"
              points={flat(wallQuad(level.walls, w))}
              closed
              fill={sel.has(w.id) ? theme.primary : theme.wall}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />
          ))}
      {layers.structure && (
        <Shape
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            for (const p of outline)
              for (const ring of [p.outer, ...p.holes]) {
                ring.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
                ctx.closePath();
              }
            ctx.strokeShape(shape);
          }}
          stroke={theme.wallStroke}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      )}
      {layers.structure &&
        level.openings
          .filter((o) => !hidden.has(o.id) && !hidden.has(o.wallId))
          .map((o) => (
            <OpeningShape key={o.id} level={level} o={o} theme={theme} px={px} selected={sel.has(o.id)} />
          ))}
      {layers.furniture &&
        level.objects
          .filter((o) => !hidden.has(o.id))
          .map((o) => {
            const fp = footprintOf(o, catalog);
            const warn = collisions.has(o.id);
            const c = centroid(fp);
            const e = catalog.get(o.catalogId);
            const ptype = e?.model.kind === 'parametric' ? e.model.type : '';
            return (
              <Group key={o.id} opacity={o.appearance?.hidden ? 0.35 : 1}>
                <Line
                  id={o.id}
                  name="object"
                  points={flat(fp)}
                  closed
                  fill={ptype === 'column' ? theme.wall : theme.object}
                  opacity={0.9}
                  stroke={sel.has(o.id) ? theme.primary : warn ? theme.warn : theme.wallStroke}
                  strokeWidth={sel.has(o.id) || warn ? 2.5 : 1}
                  dash={warn && !sel.has(o.id) ? [6, 3] : undefined}
                  strokeScaleEnabled={false}
                  perfectDrawEnabled={false}
                />
                {ptype === 'stairs' && <StairSymbol o={o} catalog={catalog} theme={theme} />}
                {ptype === 'mep' && (
                  <MepSymbol
                    id={o.id}
                    x={o.position[0]}
                    z={o.position[2]}
                    point={String(
                      o.params?.point ??
                        (e?.model.kind === 'parametric' ? e.model.params.point?.default : '') ??
                        '',
                    )}
                    px={px}
                    selected={sel.has(o.id)}
                    theme={theme}
                  />
                )}
                {e && ptype !== 'mep' && (
                  <Text
                    x={c[0]}
                    y={c[1] - 6 * px}
                    offsetX={50 * px}
                    width={100 * px}
                    align="center"
                    text={o.name || e.nameZh}
                    fontSize={10 * px}
                    fill={theme.text}
                    listening={false}
                  />
                )}
              </Group>
            );
          })}
    </>
  );
});

function OpeningShape({
  level,
  o,
  theme,
  px,
  selected,
}: {
  level: Level;
  o: Opening;
  theme: Plan2DTheme;
  px: number;
  selected: boolean;
}) {
  const ends = openingEnds(level, o);
  const w = level.walls.find((x) => x.id === o.wallId);
  if (!ends || !w) return null;
  const [p0, p1] = ends;
  const dir: Vec2 = [(p1[0] - p0[0]) / o.width, (p1[1] - p0[1]) / o.width];
  const n: Vec2 = [-dir[1], dir[0]];
  const h = w.thickness / 2;
  const quad = [
    [p0[0] - n[0] * h, p0[1] - n[1] * h],
    [p1[0] - n[0] * h, p1[1] - n[1] * h],
    [p1[0] + n[0] * h, p1[1] + n[1] * h],
    [p0[0] + n[0] * h, p0[1] + n[1] * h],
  ] as Vec2[];
  const color = selected ? theme.primary : theme.opening;
  return (
    <Group>
      <Line
        id={o.id}
        name="opening"
        points={flat(quad)}
        closed
        fill={theme.bg}
        stroke={color}
        strokeWidth={selected ? 2 : 1}
        strokeScaleEnabled={false}
      />
      {o.type === 'door' ? (
        <DoorSymbol o={o} p0={p0} p1={p1} n={n} h={h} color={color} px={px} />
      ) : (
        <WindowSymbol o={o} p0={p0} p1={p1} n={n} h={h} color={color} />
      )}
      {o.type === 'passage' && (
        <Line points={flat([p0, p1])} stroke={color} dash={[4 * px, 4 * px]} listening={false} />
      )}
    </Group>
  );
}

function Dimensions({
  level,
  px,
  unit,
  theme,
  onEdit,
}: {
  level: Level;
  px: number;
  unit: LengthUnit;
  theme: Plan2DTheme;
  onEdit: (wallId: string, x: number, y: number, text: string) => void;
}) {
  return (
    <>
      {level.walls.map((w) => {
        const len = wallLength(w);
        if (len * (1 / px) < 40) return null; // 螢幕上太短不顯示
        const mid = pointOnWall(w, len / 2);
        const d: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
        const n: Vec2 = [-d[1], d[0]];
        const off = w.thickness / 2 + 14 * px;
        const pos: Vec2 = [mid[0] + n[0] * off, mid[1] + n[1] * off];
        let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
        if (ang > 90 || ang < -90) ang += 180;
        const text = formatLength(len, unit);
        return (
          <Text
            key={w.id}
            name="dimension"
            x={pos[0]}
            y={pos[1]}
            rotation={ang}
            offsetX={40 * px}
            offsetY={6 * px}
            width={80 * px}
            align="center"
            text={text}
            fontSize={11 * px}
            fontFamily="JetBrains Mono, ui-monospace, monospace"
            fill={theme.muted}
            onDblClick={() =>
              onEdit(
                w.id,
                pos[0],
                pos[1],
                String(Math.round(unit === 'mm' ? len : unit === 'cm' ? len / 10 : len / 1000)),
              )
            }
          />
        );
      })}
    </>
  );
}

function centroid(poly: readonly Vec2[]): Vec2 {
  if (poly.length === 0) return [0, 0];
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-6) return poly[0]!;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

// ── 標註（FE-PLAN-10）─────────────────────────────────────────────

type AnnData = Record<string, unknown>;
const v2 = (x: unknown): Vec2 | null =>
  Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number' ? [x[0], x[1]] : null;

/** 標註的所有參考點（框選用） */
export function annotationPoints(d: AnnData): Vec2[] {
  return [v2(d.a), v2(d.b), v2(d.position), v2(d.target)].filter((p): p is Vec2 => !!p);
}

/** 平移標註（所有座標欄位一起動） */
export function moveAnnotation(d: AnnData, delta: Vec2): AnnData {
  const out: AnnData = { ...d };
  for (const k of ['a', 'b', 'position', 'target']) {
    const p = v2(d[k]);
    if (p) out[k] = [p[0] + delta[0], p[1] + delta[1]];
  }
  return out;
}

function AnnotationShape({
  a,
  px,
  unit,
  theme,
  selected,
}: {
  a: { id: string; type: string; data?: AnnData };
  px: number;
  unit: LengthUnit;
  theme: Plan2DTheme;
  selected: boolean;
}) {
  const d = a.data ?? {};
  const color = selected ? theme.primary : theme.text;
  if (a.type === 'dimension') {
    const dd = d as unknown as Partial<DimensionData>;
    const A = v2(dd.a);
    const B = v2(dd.b);
    if (!A || !B) return null;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1) return null;
    const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    const n: Vec2 = [-u[1], u[0]];
    const off = typeof dd.offset === 'number' ? dd.offset : 0;
    const A2: Vec2 = [A[0] + n[0] * off, A[1] + n[1] * off];
    const B2: Vec2 = [B[0] + n[0] * off, B[1] + n[1] * off];
    const tick = 8 * px;
    let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    const mid: Vec2 = [
      (A2[0] + B2[0]) / 2 + n[0] * 12 * px * Math.sign(off || 1),
      (A2[1] + B2[1]) / 2 + n[1] * 12 * px * Math.sign(off || 1),
    ];
    return (
      <Group>
        <Line
          id={a.id}
          name={a.id === 'preview' ? undefined : 'annotation'}
          points={flat([A, A2, B2, B])}
          stroke={color}
          strokeWidth={1}
          strokeScaleEnabled={false}
          hitStrokeWidth={10}
        />
        {[A2, B2].map((p, i) => (
          <Line
            key={i}
            listening={false}
            points={[
              p[0] - (u[0] + n[0]) * tick,
              p[1] - (u[1] + n[1]) * tick,
              p[0] + (u[0] + n[0]) * tick,
              p[1] + (u[1] + n[1]) * tick,
            ]}
            stroke={color}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        ))}
        <Text
          listening={false}
          x={mid[0]}
          y={mid[1]}
          rotation={ang}
          offsetX={50 * px}
          offsetY={6 * px}
          width={100 * px}
          align="center"
          text={formatLength(L, unit)}
          fontSize={12 * px}
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fill={color}
        />
      </Group>
    );
  }
  const td = d as unknown as Partial<TextData> & { target?: Vec2 };
  const P = v2(td.position);
  if (!P) return null;
  const size = typeof td.size === 'number' ? td.size : 250;
  const T = v2(td.target);
  return (
    <Group>
      {a.type === 'note' && T && (
        <Line
          listening={false}
          points={flat([P, T])}
          stroke={color}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      )}
      <Text
        id={a.id}
        name={a.id === 'preview' ? undefined : 'annotation'}
        x={P[0]}
        y={P[1]}
        rotation={typeof td.rotation === 'number' ? td.rotation : 0}
        text={String(td.text ?? '')}
        fontSize={size}
        fill={typeof td.color === 'string' ? td.color : color}
        padding={size * 0.15}
        stroke={selected ? theme.primary : undefined}
        strokeWidth={selected ? 0.5 : 0}
        strokeScaleEnabled={false}
      />
    </Group>
  );
}

// ── 測量（FE-PLAN-09）─────────────────────────────────────────────

function MeasureShape({
  pts,
  closed,
  px,
  unit,
  areaUnit,
  theme,
  t,
}: {
  pts: Vec2[];
  closed: boolean;
  px: number;
  unit: LengthUnit;
  areaUnit: AreaUnit;
  theme: Plan2DTheme;
  t: Plan2DProps['t'];
}) {
  const ring = closed ? [...pts, pts[0]!] : pts;
  let total = 0;
  const labels: { p: Vec2; text: string }[] = [];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += L;
    labels.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: formatLength(L, unit) });
  }
  const area = closed && pts.length >= 3 ? Math.abs(signedArea(pts)) : 0;
  const last = pts[pts.length - 1]!;
  return (
    <Group listening={false}>
      {closed && <Line points={flat(pts)} closed fill={theme.warn} opacity={0.15} />}
      <Line
        points={flat(ring)}
        stroke={theme.warn}
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={[8, 4]}
      />
      {pts.map((p, i) => (
        <Circle key={i} x={p[0]} y={p[1]} radius={4 * px} fill={theme.warn} />
      ))}
      {labels.map((l, i) => (
        <Text
          key={i}
          x={l.p[0]}
          y={l.p[1] - 18 * px}
          offsetX={50 * px}
          width={100 * px}
          align="center"
          text={l.text}
          fontSize={12 * px}
          fill={theme.warn}
          fontStyle="bold"
        />
      ))}
      <Text
        x={last[0] + 10 * px}
        y={last[1] + 10 * px}
        text={`${t('tools.measureTotal')} ${formatLength(total, unit)}${area ? `\n${t('tools.measureArea')} ${formatArea(area, areaUnit)}` : ''}`}
        fontSize={12 * px}
        fill={theme.text}
        padding={4 * px}
      />
    </Group>
  );
}

// ── 樓梯 2D 符號（踏階線＋上行箭頭）─────────────────────────────

function StairSymbol({
  o,
  catalog,
  theme,
}: {
  o: Level['objects'][number];
  catalog: Catalog;
  theme: Plan2DTheme;
}) {
  const e = catalog.get(o.catalogId);
  if (!e) return null;
  const d = objectDims(e, o.params, o.scale);
  const pr = resolveParams(e, o.params);
  const n = Math.max(3, Number(pr.steps ?? 16));
  const shape = String(pr.shape ?? 'straight');
  const local: Vec2[][] = [];
  if (shape === 'straight') {
    for (let i = 1; i < n; i++) {
      const z = d.d / 2 - (d.d * i) / n;
      local.push([
        [-d.w / 2, z],
        [d.w / 2, z],
      ]);
    }
    local.push([
      [0, d.d / 2 - 100],
      [0, -d.d / 2 + 100],
    ]);
  } else if (shape === 'spiral') {
    const r = Math.min(d.w, d.d) / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 1.75;
      local.push([
        [Math.cos(a) * 60, Math.sin(a) * 60],
        [Math.cos(a) * r, Math.sin(a) * r],
      ]);
    }
  } else {
    // L／U：簡化為外框對角線＋中線
    local.push([
      [-d.w / 2, d.d / 2],
      [d.w / 2, -d.d / 2],
    ]);
  }
  const c = Math.cos(o.rotationY);
  const sn = Math.sin(o.rotationY);
  const W = (p: Vec2): Vec2 => [o.position[0] + p[0] * c + p[1] * sn, o.position[2] - p[0] * sn + p[1] * c];
  return (
    <Group listening={false}>
      {local.map((seg, i) => (
        <Line
          key={i}
          points={flat(seg.map(W))}
          stroke={theme.wallStroke}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

/** 門的 2D 符號（CNS 製圖慣例）：單開／雙開／子母＝門扇＋弧；推拉＝兩片錯位；折疊＝鋸齒；隱藏＝虛線入牆；拱門＝虛線 */
function DoorSymbol({
  o,
  p0,
  p1,
  n,
  h,
  color,
  px,
}: {
  o: Opening;
  p0: Vec2;
  p1: Vec2;
  n: Vec2;
  h: number;
  color: string;
  px: number;
}) {
  const style = o.style ?? (o.swing === 'double' ? 'double' : o.swing === 'sliding' ? 'sliding' : 'single');
  const at = (t: number, k = 0): Vec2 => [
    p0[0] + (p1[0] - p0[0]) * t + n[0] * h * k,
    p0[1] + (p1[1] - p0[1]) * t + n[1] * h * k,
  ];
  const common = { stroke: color, strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
  if (style === 'sliding')
    return (
      <>
        <Line points={flat([at(0, -0.4), at(0.55, -0.4)])} {...common} strokeWidth={2} />
        <Line points={flat([at(0.45, 0.4), at(1, 0.4)])} {...common} strokeWidth={2} />
      </>
    );
  if (style === 'folding') {
    const k = Math.max(3, Math.round(o.width / 450));
    const pts: Vec2[] = [];
    for (let i = 0; i <= k; i++) pts.push(at(i / k, i % 2 ? 2.5 : 0.8));
    return <Line points={flat(pts)} {...common} />;
  }
  if (style === 'pocket')
    return (
      <>
        <Line points={flat([at(-0.95, 0), at(0.05, 0)])} {...common} dash={[6 * px, 4 * px]} />
        <Line points={flat([at(0, -1), at(0, 1)])} {...common} />
      </>
    );
  if (style === 'arch') return <Line points={flat([p0, p1])} {...common} dash={[4 * px, 4 * px]} />;
  const leaves: { hinge: Vec2; other: Vec2; sgn: 1 | -1 }[] =
    style === 'double'
      ? [
          { hinge: p0, other: at(0.5), sgn: 1 },
          { hinge: p1, other: at(0.5), sgn: -1 },
        ]
      : style === 'unequal'
        ? [
            { hinge: p0, other: at(0.66), sgn: 1 },
            { hinge: p1, other: at(0.66), sgn: -1 },
          ]
        : o.swing === 'right'
          ? [{ hinge: p1, other: p0, sgn: -1 }]
          : [{ hinge: p0, other: p1, sgn: 1 }];
  return (
    <>
      {leaves.map((l, i) => (
        <Shape
          key={i}
          listening={false}
          sceneFunc={(ctx, shape) => {
            const w = Math.hypot(l.other[0] - l.hinge[0], l.other[1] - l.hinge[1]);
            const ang = Math.atan2(l.other[1] - l.hinge[1], l.other[0] - l.hinge[0]);
            const leafEnd: Vec2 = [
              l.hinge[0] + Math.cos(ang + (l.sgn * Math.PI) / 2) * w,
              l.hinge[1] + Math.sin(ang + (l.sgn * Math.PI) / 2) * w,
            ];
            ctx.beginPath();
            ctx.moveTo(l.hinge[0], l.hinge[1]);
            ctx.lineTo(leafEnd[0], leafEnd[1]);
            ctx.arc(l.hinge[0], l.hinge[1], w, ang + (l.sgn * Math.PI) / 2, ang, l.sgn > 0);
            ctx.strokeShape(shape);
          }}
          stroke={color}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}
    </>
  );
}

/** 窗的 2D 符號：推拉＝三線；固定／轉角＝單線加粗；推射／上懸＝兩線＋中梃；凸窗＝外凸框 */
function WindowSymbol({
  o,
  p0,
  p1,
  n,
  h,
  color,
}: {
  o: Opening;
  p0: Vec2;
  p1: Vec2;
  n: Vec2;
  h: number;
  color: string;
}) {
  const style = o.style ?? 'sliding';
  const off = (k: number): Vec2[] => [
    [p0[0] + n[0] * h * k * 2, p0[1] + n[1] * h * k * 2],
    [p1[0] + n[0] * h * k * 2, p1[1] + n[1] * h * k * 2],
  ];
  const common = { stroke: color, strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
  if (style === 'fixed' || style === 'corner')
    return <Line points={flat(off(0))} {...common} strokeWidth={2.5} />;
  if (style === 'bay') {
    const depth = 450;
    const q0: Vec2 = [p0[0] - n[0] * (h + depth), p0[1] - n[1] * (h + depth)];
    const q1: Vec2 = [p1[0] - n[0] * (h + depth), p1[1] - n[1] * (h + depth)];
    const e0: Vec2 = [p0[0] - n[0] * h, p0[1] - n[1] * h];
    const e1: Vec2 = [p1[0] - n[0] * h, p1[1] - n[1] * h];
    return <Line points={flat([e0, q0, q1, e1])} {...common} strokeWidth={1.5} />;
  }
  const lines = style === 'casement' || style === 'awning' ? [-0.25, 0.25] : [-0.35, 0, 0.35];
  return (
    <>
      {lines.map((k) => (
        <Line key={k} points={flat(off(k))} {...common} />
      ))}
    </>
  );
}

/** 載入圖片（底圖用）；src 變更時重新載入 */
function useImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImg(null);
    const im = new window.Image();
    let dead = false;
    im.onload = () => !dead && setImg(im);
    im.src = src;
    return () => {
      dead = true;
    };
  }, [src]);
  return img;
}

/** 水電點位符號（FE-DOC-05）：圓圈＋代碼，顏色依種類；與施工圖圖例一致 */
export const MEP_LEGEND: Record<string, { code: string; color: string }> = {
  outlet: { code: 'P', color: '#e08a1e' },
  outlet_counter: { code: 'P+', color: '#e08a1e' },
  switch: { code: 'S', color: '#8c5bd6' },
  data: { code: 'D', color: '#3f7fd0' },
  tv: { code: 'TV', color: '#6b7380' },
  water_cold: { code: 'W', color: '#2f86e0' },
  water_hot: { code: 'H', color: '#e0513f' },
  drain: { code: 'Dr', color: '#444a52' },
  gas: { code: 'G', color: '#c9a21c' },
  ac: { code: 'AC', color: '#2aa89a' },
};
function MepSymbol({
  id,
  x,
  z,
  point,
  px,
  selected,
  theme,
}: {
  id: string;
  x: number;
  z: number;
  point: string;
  px: number;
  selected: boolean;
  theme: Plan2DTheme;
}) {
  const m = MEP_LEGEND[point] ?? { code: '?', color: theme.muted };
  const r = 9 * px;
  return (
    <Group x={x} y={z}>
      <Circle
        id={id}
        name="object"
        radius={r}
        fill="#ffffff"
        stroke={selected ? theme.primary : m.color}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeScaleEnabled={false}
      />
      <Text
        text={m.code}
        fontSize={8 * px}
        fontStyle="bold"
        fill={m.color}
        width={r * 2}
        offsetX={r}
        offsetY={4 * px}
        align="center"
        listening={false}
      />
    </Group>
  );
}

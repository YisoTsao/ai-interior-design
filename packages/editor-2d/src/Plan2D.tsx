import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { useStore } from 'zustand';
import {
  activeLevel,
  addObject,
  addOpening,
  addRectRoom,
  addWalls,
  DEFAULTS,
  moveWallVertex,
  resizeWall,
  transformObject,
  translateWall,
  updateOpening,
  type EditorStore,
} from '@interiorai/app-state';
import { defaultElevation, objectDims, type Catalog } from '@interiorai/catalog';
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
import type { Level, Opening } from '@interiorai/scene-schema';
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
}

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
  | { kind: 'pan'; start: Vec2; view: ViewTransform };

const SNAP_PX = 10;

export function Plan2D({ store, catalog, t, lengthUnit, areaUnit, theme }: Plan2DProps) {
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
    });
    return () => plan2dApi.set(null);
  }, [v, fit]);

  // 切換工具時清除草稿
  useEffect(() => {
    setDraft([]);
    setLenBuf('');
    setHover(null);
  }, [tool]);

  const tol = SNAP_PX / v.scale;
  const doSnap = useCallback(
    (p: Vec2, extra: Partial<Parameters<typeof snap>[1]> = {}) => {
      const r = snap(p, { level, tolerance: tol, gridMm: 100, disabled: !snapEnabled || altDown, ...extra });
      setSnapInfo(r);
      return r.point;
    },
    [level, tol, snapEnabled, altDown],
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
      if (tool !== 'wall' || draft.length === 0) return;
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
        } else finishDraft(false);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (draft.length >= 2) finishDraft(false);
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
  }, [tool, draft, lenBuf, hover, lengthUnit, finishDraft]);

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
    const width = openingType === 'door' ? DEFAULTS.doorWidth : DEFAULTS.windowWidth;
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
            height: DEFAULTS.doorHeight,
            sill: 0,
            swing: 'left',
          }
        : {
            id: 'preview',
            wallId: w.id,
            type: 'window',
            offset,
            width,
            height: DEFAULTS.windowHeight,
            sill: DEFAULTS.windowSill,
          };
    const clash = level.openings.some(
      (x) => x.wallId === w.id && x.offset < offset + width && offset < x.offset + x.width,
    );
    return { invalid: clash, o };
  }, [openingType, hover, level, tol]);

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
    if (tool === 'wall') {
      const q = doSnap(p, { angleFrom: draft[draft.length - 1] });
      if (draft.length >= 3 && Math.hypot(q[0] - draft[0]![0], q[1] - draft[0]![1]) <= tol)
        return finishDraft(true);
      if (e.evt.detail >= 2 && draft.length >= 2) return finishDraft(false);
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
    if (!drag) {
      if (tool === 'wall') setHover(doSnap(p, { angleFrom: draft[draft.length - 1] }));
      else if (tool === 'place' || tool === 'rect') setHover(doSnap(p));
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
        const q = doSnap([drag.orig[0] + p[0] - drag.start[0], drag.orig[2] + p[1] - drag.start[1]], {
          excludeWallIds: [],
        });
        setDrag({ ...drag, pos: [q[0], drag.orig[1], q[1]] });
        break;
      }
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
        if (drag.pos && (drag.pos[0] !== drag.orig[0] || drag.pos[2] !== drag.orig[2]))
          exec(transformObject(levelId, drag.id, { position: drag.pos }));
        break;
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

  return (
    <div
      ref={wrap}
      className="relative h-full w-full overflow-hidden"
      style={{ background: theme.bg, cursor: tool === 'select' ? 'default' : 'crosshair' }}
      data-testid="plan2d"
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
      >
        <Layer listening={false}>
          <Grid v={v} size={size} theme={theme} />
        </Layer>
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
            />
          </Group>
        </Layer>
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
            {tool === 'wall' && draft.length > 0 && (
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
                  points={flat(hover ? [...draft, hover] : draft)}
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
        className="pointer-events-none absolute bottom-2 left-2 rounded px-2 py-1 font-mono text-xs"
        style={{ background: theme.bg, color: theme.muted }}
        data-testid="snap-status"
      >
        {t(`snap.${snapEnabled && !altDown ? (snapInfo?.kind ?? 'none') : 'off'}`)}
        {tool === 'wall' && ` · ${t('hint.wallTool')}`}
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
                fill={selected ? theme.primary : theme.floor}
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
            return (
              <Group key={o.id}>
                <Line
                  id={o.id}
                  name="object"
                  points={flat(fp)}
                  closed
                  fill={theme.object}
                  opacity={0.9}
                  stroke={sel.has(o.id) ? theme.primary : warn ? theme.warn : theme.wallStroke}
                  strokeWidth={sel.has(o.id) || warn ? 2.5 : 1}
                  dash={warn && !sel.has(o.id) ? [6, 3] : undefined}
                  strokeScaleEnabled={false}
                  perfectDrawEnabled={false}
                />
                {e && (
                  <Text
                    x={c[0]}
                    y={c[1] - 6 * px}
                    offsetX={50 * px}
                    width={100 * px}
                    align="center"
                    text={e.nameZh}
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
        <Shape
          listening={false}
          sceneFunc={(ctx, shape) => {
            const hinge = o.swing === 'right' ? p1 : p0;
            const other = o.swing === 'right' ? p0 : p1;
            const ang = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
            const sgn = o.swing === 'right' ? -1 : 1;
            const leafEnd: Vec2 = [
              hinge[0] + Math.cos(ang + (sgn * Math.PI) / 2) * o.width,
              hinge[1] + Math.sin(ang + (sgn * Math.PI) / 2) * o.width,
            ];
            ctx.beginPath();
            ctx.moveTo(hinge[0], hinge[1]);
            ctx.lineTo(leafEnd[0], leafEnd[1]);
            ctx.arc(hinge[0], hinge[1], o.width, ang + (sgn * Math.PI) / 2, ang, sgn > 0);
            ctx.strokeShape(shape);
          }}
          stroke={color}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ) : (
        [-0.35, 0, 0.35].map((k) => (
          <Line
            key={k}
            listening={false}
            points={[
              p0[0] + n[0] * h * k * 2,
              p0[1] + n[1] * h * k * 2,
              p1[0] + n[0] * h * k * 2,
              p1[1] + n[1] * h * k * 2,
            ]}
            stroke={color}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        ))
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

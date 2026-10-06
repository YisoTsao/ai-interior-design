import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { closestOnSegment, detectRooms, type Vec2 } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';

/** 人的碰撞半徑 mm */
const BODY_R = 230;
const EYE = 1600;
const SPEED = 1400; // mm/s（步行）

/**
 * 牆的碰撞：p 與牆中心線距離 < 牆厚/2＋身體半徑 → 擋住；但在門／通道（落地開口）的寬度範圍內可通過。
 */
export function blockedByWalls(level: Pick<Level, 'walls' | 'openings'>, p: Vec2, r = BODY_R): boolean {
  for (const w of level.walls) {
    const c = closestOnSegment(p, w.a as Vec2, w.b as Vec2);
    if (c.distance >= w.thickness / 2 + r) continue;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const along = c.t * L;
    const door = level.openings.some(
      (o) =>
        o.wallId === w.id &&
        o.type !== 'window' &&
        (o.sill ?? 0) < 300 &&
        along > o.offset + r * 0.6 &&
        along < o.offset + o.width - r * 0.6,
    );
    if (!door) return true;
  }
  return false;
}

/** 起點：最大房間的重心（沒有房間時用牆的外框中心） */
export function walkStart(level: Level): Vec2 {
  const rooms = detectRooms(level).rooms.filter((r) => r.floor.length >= 3);
  if (rooms.length) {
    const big = rooms.reduce((a, b) => (b.netArea > a.netArea ? b : a));
    const n = big.floor.length;
    return [big.floor.reduce((s, p) => s + p[0], 0) / n, big.floor.reduce((s, p) => s + p[1], 0) / n];
  }
  const xs = level.walls.flatMap((w) => [w.a[0], w.b[0]]);
  const zs = level.walls.flatMap((w) => [w.a[1], w.b[1]]);
  return xs.length
    ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
    : [0, 0];
}

/**
 * 第一人稱漫遊（FE-V3D-01）：WASD／方向鍵移動、Shift 奔跑、點畫面鎖定滑鼠後轉頭（Esc 解鎖）、
 * 未鎖定時可拖曳滑鼠轉頭。眼高 1.6 m；與牆碰撞（可穿過門），沿牆滑動。
 */
export function WalkControls({ level, onExit }: { level: Level; onExit: () => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const [x, z] = walkStart(level);
    camera.position.set(x, EYE, z);
    const prevFov = camera.fov;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    yaw.current = 0;
    pitch.current = 0;
    camera.rotation.set(0, 0, 0, 'YXZ');
    invalidate();
    const el = gl.domElement;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        keys.current.add(k);
        e.preventDefault();
        e.stopPropagation();
        invalidate();
      } else if (k === 'escape' && document.pointerLockElement !== el) onExit();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    let dragging = false;
    const look = (dx: number, dy: number) => {
      yaw.current -= dx * 0.0025;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - dy * 0.0025));
      invalidate();
    };
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement === el) look(e.movementX, e.movementY);
      else if (dragging) look(e.movementX, e.movementY);
    };
    const mdown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      if (e.detail >= 2) void el.requestPointerLock?.();
    };
    const mup = () => (dragging = false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousemove', move);
    el.addEventListener('mousedown', mdown);
    window.addEventListener('mouseup', mup);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousemove', move);
      el.removeEventListener('mousedown', mdown);
      window.removeEventListener('mouseup', mup);
      if (document.pointerLockElement === el) document.exitPointerLock();
      camera.fov = prevFov;
      camera.updateProjectionMatrix();
    };
  }, [camera, gl, invalidate, onExit]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const k = keys.current;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    if (f || r) {
      const sp = SPEED * (k.has('shift') ? 2 : 1) * Math.min(dt, 0.05);
      const fw: Vec2 = [-Math.sin(yaw.current), -Math.cos(yaw.current)];
      const rt: Vec2 = [Math.cos(yaw.current), -Math.sin(yaw.current)];
      const dx = (fw[0] * f + rt[0] * r) * sp;
      const dz = (fw[1] * f + rt[1] * r) * sp;
      const p: Vec2 = [camera.position.x, camera.position.z];
      // 分軸移動 → 沿牆滑動
      if (!blockedByWalls(levelRef.current, [p[0] + dx, p[1]])) p[0] += dx;
      if (!blockedByWalls(levelRef.current, [p[0], p[1] + dz])) p[1] += dz;
      camera.position.set(p[0], EYE, p[1]);
      invalidate();
    }
  });
  return null;
}

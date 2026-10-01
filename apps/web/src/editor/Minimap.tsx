import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, X } from 'lucide-react';
import { activeLevel } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { useEditor } from './context';

const SIZE = 168;

/**
 * 3D 小地圖（FE-UX-09）：右下角的 2D 平面（牆、門窗位置）＋相機位置與視角錐；
 * 點小地圖＝相機改看那個點（保持目前的距離與方向）。可收合（本機記住）。
 */
export function Minimap() {
  const { t } = useTranslation();
  const level = useEditor(activeLevel);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('minimap') !== 'off';
    } catch {
      return true;
    }
  });
  const [cam, setCam] = useState<{ p: [number, number]; t: [number, number]; fov: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      const c = viewer3dApi.get()?.currentCamera();
      if (c) setCam({ p: [c.position[0], c.position[2]], t: [c.target[0], c.target[2]], fov: c.fovDeg });
    }, 150);
    return () => window.clearInterval(id);
  }, [open]);
  const box = useMemo(() => {
    const xs = level.walls.flatMap((w) => [w.a[0], w.b[0]]);
    const zs = level.walls.flatMap((w) => [w.a[1], w.b[1]]);
    if (!xs.length) return null;
    const pad = 800;
    const x0 = Math.min(...xs) - pad;
    const z0 = Math.min(...zs) - pad;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 2 * pad;
    return { x0, z0, span };
  }, [level.walls]);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem('minimap', v ? 'on' : 'off');
    } catch {
      /* 私密模式 */
    }
  };
  if (!open)
    return (
      <button
        className="hud-panel icon-btn absolute right-3 bottom-3 z-10"
        aria-label={t('minimap.show')}
        title={t('minimap.show')}
        onClick={() => toggle(true)}
        data-testid="minimap-show"
      >
        <MapIcon size={16} aria-hidden />
      </button>
    );
  if (!box) return null;
  const k = SIZE / box.span;
  // 剖面模型的相機常在平面外 → 點位夾到地圖邊緣（方向仍正確）
  const P = (x: number, z: number) =>
    [
      Math.min(SIZE - 4, Math.max(4, (x - box.x0) * k)),
      Math.min(SIZE - 4, Math.max(4, (z - box.z0) * k)),
    ] as const;
  let cone: string | null = null;
  if (cam) {
    const [px, pz] = P(cam.p[0], cam.p[1]);
    const dir = Math.atan2(cam.t[1] - cam.p[1], cam.t[0] - cam.p[0]);
    const half = (((cam.fov / 2) * Math.PI) / 180) * 1.3;
    const r = 34;
    cone = `M${px},${pz} L${px + Math.cos(dir - half) * r},${pz + Math.sin(dir - half) * r} A${r},${r} 0 0 1 ${px + Math.cos(dir + half) * r},${pz + Math.sin(dir + half) * r} Z`;
  }
  return (
    <div className="hud-panel absolute right-3 bottom-3 z-10 p-1" data-testid="minimap">
      <button
        className="icon-btn absolute top-0.5 right-0.5 h-5 w-5"
        aria-label={t('minimap.hide')}
        title={t('minimap.hide')}
        onClick={() => toggle(false)}
      >
        <X size={12} aria-hidden />
      </button>
      <svg
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={t('minimap.title')}
        className="cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = box.x0 + (e.clientX - r.left) / k;
          const z = box.z0 + (e.clientY - r.top) / k;
          const v = viewer3dApi.get();
          const c = v?.currentCamera();
          if (!v || !c) return;
          const d = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
          v.setCamera({
            target: [Math.round(x), c.target[1], Math.round(z)],
            position: [Math.round(x + d[0]!), c.position[1], Math.round(z + d[2]!)],
            fovDeg: c.fovDeg,
          });
        }}
        data-testid="minimap-svg"
      >
        {level.walls.map((w) => {
          const [ax, az] = P(w.a[0], w.a[1]);
          const [bx, bz] = P(w.b[0], w.b[1]);
          return (
            <line
              key={w.id}
              x1={ax}
              y1={az}
              x2={bx}
              y2={bz}
              stroke="var(--wall)"
              strokeWidth={Math.max(1.5, w.thickness * k)}
              strokeLinecap="square"
            />
          );
        })}
        {level.objects.map((o) => {
          const [x, z] = P(o.position[0], o.position[2]);
          return <circle key={o.id} cx={x} cy={z} r={1.6} fill="var(--muted)" />;
        })}
        {cone && (
          <path d={cone} fill="var(--primary)" fillOpacity={0.3} stroke="var(--primary)" strokeWidth={1} />
        )}
        {cam && (
          <circle cx={P(cam.p[0], cam.p[1])[0]} cy={P(cam.p[0], cam.p[1])[1]} r={3.5} fill="var(--primary)" />
        )}
      </svg>
    </div>
  );
}

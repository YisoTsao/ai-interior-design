import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/** 全景熱點（FE-RND-02）：經度 0 朝 −Z、往右為正（與 renderPanorama 一致）；緯度往上為正 */
export interface PanoHotspot {
  id: string;
  label: string;
  lonDeg: number;
  latDeg?: number;
}

/** 由 A 看向 B 的經度（俯視：x 右、z 下；0＝−Z，順時針為正） */
export const lonToward = (from: readonly number[], to: readonly number[]) =>
  (Math.atan2(to[0]! - from[0]!, -(to[1]! - from[1]!)) * 180) / Math.PI;

/**
 * 全景檢視（FE-RND-02）：等距柱狀影像貼在內側球面；拖曳轉頭、滾輪縮放視角，支援觸控；
 * 熱點（點擊跳轉房間）；手機陀螺儀（DeviceOrientation，可開關）。獨立的輕量 three 渲染器。
 */
export function PanoramaViewer({
  src,
  className,
  hotspots = [],
  onHotspot,
  labels,
}: {
  src: string;
  className?: string;
  hotspots?: PanoHotspot[];
  onHotspot?: (id: string) => void;
  labels?: { gyroOn: string; gyroOff: string };
}) {
  const host = useRef<HTMLDivElement>(null);
  const spotEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [gyro, setGyro] = useState(false);
  const [gyroAvailable] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
  const gyroRef = useRef(false);
  gyroRef.current = gyro;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.prepend(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const geo = new THREE.SphereGeometry(10, 64, 32);
    geo.scale(-1, 1, 1); // 從內側看，且水平方向不鏡像
    const tex = new THREE.TextureLoader().load(src, () => draw());
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    // SphereGeometry 的 u=0.5 在 −X；轉 −90° 使影像中心（經度 0）朝 −Z
    mesh.rotation.y = -Math.PI / 2;
    scene.add(mesh);
    let yaw = 0;
    let pitch = 0;
    const v = new THREE.Vector3();
    const placeSpots = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      for (const s of hotspots) {
        const b = spotEls.current.get(s.id);
        if (!b) continue;
        const lon = (s.lonDeg * Math.PI) / 180;
        const lat = ((s.latDeg ?? -10) * Math.PI) / 180;
        v.set(Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)).multiplyScalar(5);
        v.project(camera);
        const behind = v.z > 1;
        b.style.display = behind ? 'none' : 'block';
        b.style.left = `${((v.x + 1) / 2) * w}px`;
        b.style.top = `${((1 - v.y) / 2) * h}px`;
      }
    };
    const draw = () => {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      placeSpots();
    };
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!drag || gyroRef.current) return;
      const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
      yaw += (e.clientX - drag.x) * k;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.y) * k));
      drag = { x: e.clientX, y: e.clientY };
      draw();
    };
    const up = () => {
      drag = null;
      renderer.domElement.style.cursor = 'grab';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05));
      camera.updateProjectionMatrix();
      draw();
    };
    // 陀螺儀：alpha（方位）→ yaw、beta（前後傾）→ pitch；以開啟時的方位為基準
    let alpha0: number | null = null;
    const orient = (e: DeviceOrientationEvent) => {
      if (!gyroRef.current || e.alpha === null || e.beta === null) return;
      alpha0 ??= e.alpha + (yaw * 180) / Math.PI;
      yaw = ((alpha0 - e.alpha) * -Math.PI) / 180;
      pitch = Math.max(-1.5, Math.min(1.5, ((e.beta - 90) * Math.PI) / 180));
      draw();
    };
    const c = renderer.domElement;
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('deviceorientation', orient);
    resize();
    return () => {
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
      window.removeEventListener('deviceorientation', orient);
      geo.dispose();
      tex.dispose();
      (mesh.material as THREE.Material).dispose();
      renderer.dispose();
      c.remove();
    };
  }, [src, hotspots]);
  const toggleGyro = async () => {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (!gyro && DOE.requestPermission) {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return;
      } catch {
        return;
      }
    }
    setGyro(!gyro);
  };
  return (
    <div
      ref={host}
      className={`relative overflow-hidden ${className ?? 'h-full w-full'}`}
      data-testid="pano-viewer"
    >
      {hotspots.map((s) => (
        <button
          key={s.id}
          ref={(b) => {
            if (b) spotEls.current.set(s.id, b);
            else spotEls.current.delete(s.id);
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60 px-3 py-1 text-xs font-bold whitespace-nowrap text-white shadow-lg hover:bg-black/80"
          onClick={() => onHotspot?.(s.id)}
          data-testid={`pano-hotspot-${s.id}`}
        >
          {s.label}
        </button>
      ))}
      {gyroAvailable && labels && (
        <button
          className="absolute top-2 right-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
          aria-pressed={gyro}
          onClick={() => void toggleGyro()}
          data-testid="pano-gyro"
        >
          {gyro ? labels.gyroOff : labels.gyroOn}
        </button>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CatalogEntry, Material } from '@interiorai/catalog';
import { buildPreviewObject } from './thumbnails.js';

/**
 * 資產詳情的 3D 預覽（FE-AST-05）：拖曳旋轉、滾輪縮放；自動慢轉。獨立的小型 renderer。
 */
export function ModelPreview({
  entry,
  materials,
  materialId,
  className,
}: {
  entry: CatalogEntry;
  materials: ReadonlyMap<string, Material>;
  materialId?: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8a58c', 1.4));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-1, 2, 1.5);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 1, 1, 1e7);
    const pivot = new THREE.Group();
    scene.add(pivot);
    let yaw = 0.6;
    let pitch = 0.45;
    let zoom = 1;
    let radius = 1000;
    let center = new THREE.Vector3();
    let raf = 0;
    let dragging = false;
    let dead = false;
    const draw = () => {
      const d = (radius / Math.sin((15 * Math.PI) / 180)) * zoom;
      cam.position.set(
        center.x + Math.sin(yaw) * Math.cos(pitch) * d,
        center.y + Math.sin(pitch) * d,
        center.z + Math.cos(yaw) * Math.cos(pitch) * d,
      );
      cam.near = d / 100;
      cam.far = d * 5;
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
    };
    const loop = () => {
      if (!dragging) yaw += 0.004;
      draw();
      raf = requestAnimationFrame(loop);
    };
    void buildPreviewObject(entry, materials, materialId).then((obj) => {
      if (dead || !obj) return;
      pivot.add(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const s = box.getBoundingSphere(new THREE.Sphere());
      radius = s.radius;
      center = s.center;
      loop();
    });
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let last: [number, number] | null = null;
    const c = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true;
      last = [e.clientX, e.clientY];
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      yaw -= (e.clientX - last[0]) * 0.01;
      pitch = Math.max(-0.2, Math.min(1.4, pitch + (e.clientY - last[1]) * 0.01));
      last = [e.clientX, e.clientY];
    };
    const up = () => {
      dragging = false;
      last = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(0.5, Math.min(2.5, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    resize();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
      // 上傳模型的 clone 與快取共用幾何／材質 → 只釋放參數化家具自己建的
      if (entry.model.kind === 'parametric')
        pivot.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
          }
        });
      renderer.dispose();
      c.remove();
    };
  }, [entry, materials, materialId]);
  return <div ref={host} className={className ?? 'h-64 w-full'} data-testid="model-preview" />;
}

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * 全景檢視（FE-RND-02）：等距柱狀影像貼在內側球面；拖曳轉頭、滾輪縮放視角，
 * 支援觸控。獨立的輕量 three 渲染器（不依賴編輯器場景）。
 */
export function PanoramaViewer({ src, className }: { src: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
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
    const draw = () => {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
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
      if (!drag) return;
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
    const c = renderer.domElement;
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    resize();
    return () => {
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
      geo.dispose();
      tex.dispose();
      (mesh.material as THREE.Material).dispose();
      renderer.dispose();
      c.remove();
    };
  }, [src]);
  return <div ref={host} className={className ?? 'h-full w-full'} data-testid="pano-viewer" />;
}

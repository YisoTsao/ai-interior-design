import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialCache } from './resources.js';
import { DOLLHOUSE } from './style.js';

/** 互動品質旗標：orbiting＝只動相機（陰影不必重算）；dragging＝物件在動（陰影要重算） */
export interface QualityState {
  orbiting: boolean;
  dragging: boolean;
}

function gradientBackground(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#f1ece5');
  grd.addColorStop(0.55, '#ddd5ca');
  grd.addColorStop(1, '#c4b9ab');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 等角剖面模型的舞台：暖色主光＋軟陰影、半球補光、RoomEnvironment 反射、
 * 暖灰漸層背景、木紋底板、GTAO 後處理。互動中降級（不跑 AO；純旋轉時不重算陰影）。
 */
export function DollhouseStage({
  bbox,
  mats,
  quality,
}: {
  bbox: THREE.Box3;
  mats: MaterialCache;
  quality: React.RefObject<QualityState>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);

  // renderer 與環境反射
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = DOLLHOUSE.exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(gl);
    const env = new RoomEnvironment();
    const rt = pm.fromScene(env, 0.04);
    env.dispose();
    pm.dispose();
    const bg = gradientBackground();
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.4;
    scene.background = bg;
    invalidate();
    return () => {
      scene.environment = null;
      scene.background = null;
      rt.dispose();
      bg?.dispose();
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, scene, invalidate]);

  // 房子尺寸 → 主光位置與陰影相機範圍（貼合房子，避免陰影糊掉）
  const center = useMemo(() => bbox.getCenter(new THREE.Vector3()), [bbox]);
  const extent = useMemo(() => {
    const s = bbox.getSize(new THREE.Vector3());
    return Math.hypot(s.x, s.z) / 2 + DOLLHOUSE.boardMargin;
  }, [bbox]);
  const sun = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    const dir = new THREE.Vector3(-0.45, 1, 0.55).normalize();
    l.position.copy(center).addScaledVector(dir, extent * 2);
    l.target.position.copy(center);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = extent * 0.5;
    cam.far = extent * 4;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.radius = 5;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 12;
    l.shadow.map?.dispose();
    l.shadow.map = null;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [center, extent, gl, invalidate]);

  // 木紋底板（外擴 boardMargin，厚 boardThickness，邊緣倒角）
  const board = useMemo(() => {
    const s = bbox.getSize(new THREE.Vector3());
    const w = s.x + DOLLHOUSE.boardMargin * 2;
    const d = s.z + DOLLHOUSE.boardMargin * 2;
    const g = new RoundedBoxGeometry(w, DOLLHOUSE.boardThickness, d, 3, 25);
    // RoundedBox 的 UV 是 0..1；換成 mm 以配合 repeat = 1/realSize
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    return g;
  }, [bbox]);
  useEffect(() => () => board.dispose(), [board]);

  // 後處理：RenderPass → GTAO → OutputPass（色調映射＋sRGB）
  const post = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 512, 512);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: 450, distanceExponent: 1.5, thickness: 800, scale: 1.2, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    return { composer, ao };
  }, [gl, scene, camera]);
  useEffect(() => {
    post.composer.setPixelRatio(dpr);
    post.composer.setSize(size.width, size.height);
    invalidate();
  }, [post, size.width, size.height, dpr, invalidate]);
  useEffect(
    () => () => {
      post.ao.dispose();
      post.composer.dispose();
    },
    [post],
  );

  // 互動時直接輸出到畫面（與 composer 的 HalfFloat 目標是不同的 shader 變體）→ 預先編譯，避免第一次旋轉卡頓
  useEffect(() => {
    const id = setTimeout(() => void gl.compileAsync(scene, camera).then(() => invalidate()), 300);
    return () => clearTimeout(id);
  }, [gl, scene, camera, invalidate]);

  // priority 1 → 由此接手渲染
  useFrame(() => {
    const q = quality.current;
    gl.shadowMap.needsUpdate = !q?.orbiting;
    if (q?.orbiting || q?.dragging) gl.render(scene, camera);
    else post.composer.render();
  }, 1);

  return (
    <>
      <hemisphereLight args={['#ffffff', '#d9c3a5', 0.6]} />
      <directionalLight ref={sun} color="#fff1dc" intensity={2.6} castShadow />
      <mesh
        geometry={board}
        material={mats.get('style_board_wood', '#a98462')}
        position={[center.x, -DOLLHOUSE.boardThickness / 2 - 2, center.z]}
        receiveShadow
      />
    </>
  );
}

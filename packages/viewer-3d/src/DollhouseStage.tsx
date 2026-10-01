import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { Environment } from '@interiorai/scene-schema';
import { GradeShader } from './effects.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialCache } from './resources.js';
import type { LightingMode } from './lighting.js';
import { vignetteTexture } from './NightScene.js';
import {
  DEFAULT_GRAPHICS,
  DOLLHOUSE,
  dofAperture,
  DOF_MAX_BLUR,
  NIGHT,
  QUALITY_BUDGET,
  SUN_DEFAULT,
  presetDirection,
  type GraphicsSettings,
} from './style.js';

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
  lighting = 'day',
  env,
  graphics = DEFAULT_GRAPHICS,
  ambient,
  outline,
  outlineColor = '#ffd166',
  capture,
  dof,
}: {
  /** 景深（FE-V3D-10）：focus() 回傳對焦距離 mm；互動中關閉 */
  dof?: { fStop: number; focus: () => number } | null;
  bbox: THREE.Box3;
  mats: MaterialCache;
  quality: React.RefObject<QualityState>;
  /** night：夜間氛圍（images1）— 無日光、燈具為主光源、bloom、暈影背景；底座由 Plinth 另外繪製 */
  lighting?: LightingMode;
  /** 場景環境（太陽方位／強度、曝光、環境光倍率） */
  env?: Environment;
  graphics?: GraphicsSettings;
  /** 夜間的間接光（依燈具光通量估計，ADR-023）；未提供時用 NIGHT.hemi */
  ambient?: { color: string; ground: string; intensity: number };
  /** 選取外框的物件（遊戲式選取光暈） */
  outline?: React.RefObject<THREE.Object3D[]>;
  outlineColor?: string;
  /** 截圖：以完整後處理渲染一次並回傳 PNG dataURL */
  capture?: React.RefObject<((w?: number, h?: number) => string) | null>;
}) {
  const night = lighting === 'night';
  const budget = QUALITY_BUDGET[graphics.quality];
  const ev = env?.exposureEv ?? 0;
  const ambientK = env?.ambient ?? 1;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);

  // renderer 與環境反射
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    // 夜間的曝光直接作用在物理光源（見 Viewer3D 的 photometric scale），色調映射曝光固定
    gl.toneMappingExposure = night ? 1 : DOLLHOUSE.exposure * 2 ** ev;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(gl);
    const env = new RoomEnvironment();
    const rt = pm.fromScene(env, 0.04);
    env.dispose();
    pm.dispose();
    const bg = night ? vignetteTexture() : gradientBackground();
    // 夜間不用明亮的攝影棚環境：光滑地板的菲涅耳反射會蓋過燈光、把深色木頭洗成灰白；
    // 夜間的反光只來自實際燈具的鏡面高光（images1）
    scene.environment = night ? null : rt.texture;
    scene.environmentIntensity = night ? NIGHT.envIntensity : 0.4;
    scene.background = bg;
    invalidate();
    return () => {
      scene.environment = null;
      scene.background = null;
      rt.dispose();
      bg?.dispose();
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, scene, invalidate, night, ev]);

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
    const dir = new THREE.Vector3(
      ...presetDirection(
        env?.sunAzimuthDeg ?? SUN_DEFAULT.azimuthDeg,
        env?.sunElevationDeg ?? SUN_DEFAULT.elevationDeg,
      ),
    );
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
    l.shadow.mapSize.set(budget.sunShadow, budget.sunShadow);
    l.shadow.radius = 5;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 12;
    l.shadow.map?.dispose();
    l.shadow.map = null;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [center, extent, gl, invalidate, env?.sunAzimuthDeg, env?.sunElevationDeg, budget.sunShadow]);

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

  // 後處理：RenderPass（MSAA）→ GTAO → Outline → Bloom（夜間）→ OutputPass（色調映射＋sRGB）→ 調色／暗角
  const post = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: budget.msaa });
    const composer = new EffectComposer(gl, rt);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, budget.ao, budget.ao);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: 450, distanceExponent: 1.5, thickness: 800, scale: 1.2, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    ao.enabled = graphics.ao;
    composer.addPass(ao);
    const out = new OutlinePass(new THREE.Vector2(512, 512), scene, camera);
    out.edgeStrength = 4;
    out.edgeGlow = 0.6;
    out.edgeThickness = 1.5;
    out.pulsePeriod = 0;
    out.visibleEdgeColor.set(outlineColor);
    out.hiddenEdgeColor.set(outlineColor).multiplyScalar(0.35);
    composer.addPass(out);
    // 夜間：自發光部件（燈罩、燈板、螢幕、LED）的光暈
    const bloom =
      night && graphics.bloom > 0
        ? new UnrealBloomPass(
            new THREE.Vector2(512, 512),
            NIGHT.bloom.strength * graphics.bloom,
            NIGHT.bloom.radius,
            NIGHT.bloom.threshold,
          )
        : null;
    if (bloom) composer.addPass(bloom);
    const bokeh = new BokehPass(scene, camera, {
      focus: 3000,
      aperture: dofAperture(4),
      maxblur: DOF_MAX_BLUR,
    });
    bokeh.enabled = false;
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GradeShader);
    grade.uniforms.vignette!.value = night ? 0.5 : 0.28;
    grade.uniforms.saturation!.value = night ? 1.1 : 1.04;
    grade.uniforms.contrast!.value = night ? 1.07 : 1.03;
    grade.uniforms.warmth!.value = night ? 0.004 : 0.006;
    grade.enabled = graphics.grade;
    composer.addPass(grade);
    return { composer, ao, bloom, out, rt, bokeh };
  }, [
    gl,
    scene,
    camera,
    night,
    budget.msaa,
    budget.ao,
    graphics.ao,
    graphics.bloom,
    graphics.grade,
    outlineColor,
  ]);
  const dprRef = useRef(dpr);
  dprRef.current = dpr;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    post.composer.setPixelRatio(dpr);
    post.composer.setSize(size.width, size.height);
    invalidate();
  }, [post, size.width, size.height, dpr, invalidate]);
  useEffect(
    () => () => {
      post.ao.dispose();
      post.bloom?.dispose();
      post.out.dispose();
      post.bokeh.dispose();
      post.composer.dispose();
      post.rt.dispose();
    },
    [post],
  );
  useEffect(() => {
    if (!capture) return;
    capture.current = (w, h) => {
      post.ao.enabled = graphics.ao;
      gl.shadowMap.needsUpdate = true;
      // 指定解析度（2K／4K 出圖）：暫時把後處理鏈調到該尺寸，輸出後還原
      if (w && h) {
        post.composer.setPixelRatio(1);
        post.composer.setSize(w, h);
      }
      post.composer.render();
      const url = gl.domElement.toDataURL('image/png');
      if (w && h) {
        post.composer.setPixelRatio(dprRef.current);
        post.composer.setSize(sizeRef.current.width, sizeRef.current.height);
      }
      return url;
    };
    return () => {
      capture.current = null;
    };
  }, [capture, post, gl, graphics.ao]);

  // 互動時直接輸出到畫面（與 composer 的 HalfFloat 目標是不同的 shader 變體）→ 預先編譯，避免第一次旋轉卡頓
  useEffect(() => {
    const id = setTimeout(() => void gl.compileAsync(scene, camera).then(() => invalidate()), 300);
    return () => clearTimeout(id);
  }, [gl, scene, camera, invalidate]);

  // priority 1 → 由此接手渲染；互動中只關 AO（其餘後處理保留，避免旋轉時畫面跳動）
  // 互動中的解析度倍率（FE-V3D-12）：旋轉／拖曳時降為 0.6×，放開恢復
  const resScale = useRef(1);
  const dofRef = useRef(dof);
  dofRef.current = dof;
  useFrame(() => {
    const q = quality.current;
    gl.shadowMap.needsUpdate = !q?.orbiting;
    const interacting = q?.orbiting || q?.dragging;
    const want = interacting && (graphics.dynamicRes ?? true) ? 0.6 : 1;
    if (want !== resScale.current) {
      resScale.current = want;
      post.composer.setPixelRatio(Math.max(0.5, dprRef.current * want));
      post.composer.setSize(sizeRef.current.width, sizeRef.current.height);
      if (want === 1) invalidate(); // 停止互動後補一張全解析度
    }
    const d = dofRef.current;
    post.bokeh.enabled = !!d && !interacting;
    if (d && !interacting) {
      const u = post.bokeh.uniforms as Record<string, THREE.IUniform<number>>;
      u.focus!.value = d.focus();
      u.aperture!.value = dofAperture(d.fStop);
    }
    // 統計一整個畫格（含後處理各 pass）的 draw calls / 三角形
    gl.info.autoReset = false;
    gl.info.reset();
    post.ao.enabled = graphics.ao && !interacting;
    post.out.selectedObjects = outline?.current ?? [];
    post.out.enabled = post.out.selectedObjects.length > 0;
    post.composer.render();
  }, 1);

  return (
    <>
      {night ? (
        <hemisphereLight
          args={[
            ambient?.color ?? NIGHT.hemi.sky,
            ambient?.ground ?? NIGHT.hemi.ground,
            (ambient?.intensity ?? NIGHT.hemi.intensity) * ambientK,
          ]}
        />
      ) : (
        <hemisphereLight args={['#ffffff', '#d9c3a5', 0.6 * ambientK]} />
      )}
      <directionalLight
        ref={sun}
        color="#fff1dc"
        intensity={night ? 0 : (env?.sunIntensity ?? SUN_DEFAULT.intensity)}
        castShadow={!night}
      />
      <mesh
        visible={!night}
        geometry={board}
        material={mats.get('style_board_wood', '#a98462')}
        position={[center.x, -DOLLHOUSE.boardThickness / 2 - 2, center.z]}
        receiveShadow
        userData={{ gkind: 'board', id: 'board' }}
      />
    </>
  );
}

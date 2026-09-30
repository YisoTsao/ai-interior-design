import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { Vec2 } from '@interiorai/core-geometry';
import {
  POOL_SIZE,
  areaLuminance,
  pointIntensity,
  spotIntensity,
  type LightPools,
  type LightSource,
} from './lighting.js';
import { NIGHT } from './style.js';

let rectLibReady = false;
const off = (i: number) => new THREE.Vector3(0, -1e6 - i, 0);

/**
 * 燈具光源池（夜間氛圍）：固定數量的 point/spot/area → 光源增減不會重新編譯 shader。
 * 物理量：lm → cd（點/聚光，mm 世界 ×1e6）或 nit（面光源），再乘 NIGHT.photometricScale。
 */
export function FixtureLights({
  pools,
  scale = NIGHT.photometricScale,
  shadowSize = { spot: 1024, point: 512 },
}: {
  pools: LightPools;
  /** 光度 → 顯示值（NIGHT.photometricScale × 2^曝光 EV） */
  scale?: number;
  shadowSize?: { spot: number; point: number };
}) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  if (!rectLibReady) {
    RectAreaLightUniformsLib.init();
    rectLibReady = true;
  }
  const points = useRef<(THREE.PointLight | null)[]>([]);
  const spots = useRef<(THREE.SpotLight | null)[]>([]);
  const areas = useRef<(THREE.RectAreaLight | null)[]>([]);
  const k = scale;

  useLayoutEffect(() => {
    const color = new THREE.Color();
    const apply = <T extends THREE.Light>(
      ls: (T | null)[],
      src: LightSource[],
      set: (l: T, s: LightSource | undefined, i: number) => void,
    ) => ls.forEach((l, i) => l && set(l, src[i], i));
    apply(points.current, pools.point, (l, s, i) => {
      if (!s) {
        l.intensity = 0;
        l.position.copy(off(i));
        l.castShadow = false;
        return;
      }
      l.position.set(...s.position);
      l.color.copy(color.set(s.color));
      l.intensity = pointIntensity(s.lumens) * k;
      l.distance = s.rangeMm ?? 0;
      l.castShadow = s.castShadow;
      l.shadow.radius = s.shadowSoftness ?? 4;
    });
    apply(spots.current, pools.spot, (l, s, i) => {
      if (!s) {
        l.intensity = 0;
        l.position.copy(off(i));
        l.castShadow = false;
        return;
      }
      const beam = s.beamDeg ?? 60;
      l.position.set(...s.position);
      l.target.position.set(
        s.position[0] + s.direction[0] * 1000,
        s.position[1] + s.direction[1] * 1000,
        s.position[2] + s.direction[2] * 1000,
      );
      l.target.updateMatrixWorld();
      l.angle = ((beam / 2) * Math.PI) / 180;
      l.penumbra = s.penumbra ?? 0.8;
      l.distance = s.rangeMm ?? 0;
      l.color.copy(color.set(s.color));
      l.intensity = spotIntensity(s.lumens, beam) * k;
      l.castShadow = s.castShadow;
      l.shadow.radius = s.shadowSoftness ?? 5;
    });
    apply(areas.current, pools.area, (l, s, i) => {
      if (!s || !s.size) {
        l.intensity = 0;
        l.position.copy(off(i));
        return;
      }
      l.position.set(...s.position);
      l.width = s.size.w;
      l.height = s.size.h;
      l.up.set(...(s.up ?? [0, 1, 0]));
      l.lookAt(
        s.position[0] + s.direction[0],
        s.position[1] + s.direction[1],
        s.position[2] + s.direction[2],
      );
      l.color.copy(color.set(s.color));
      l.intensity = areaLuminance(s.lumens, s.size.w, s.size.h) * k;
    });
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [pools, k, gl, invalidate]);

  return (
    <>
      {Array.from({ length: POOL_SIZE.point }, (_, i) => (
        <pointLight
          key={`p${i}`}
          ref={(l) => void (points.current[i] = l)}
          decay={2}
          distance={0}
          intensity={0}
          shadow-mapSize={[shadowSize.point, shadowSize.point]}
          shadow-bias={-0.004}
          shadow-radius={4}
          shadow-camera-near={30}
          shadow-camera-far={12000}
        />
      ))}
      {Array.from({ length: POOL_SIZE.spot }, (_, i) => (
        <spotLight
          key={`s${i}`}
          ref={(l) => {
            spots.current[i] = l;
            if (l && !l.target.parent) l.parent?.add(l.target);
          }}
          decay={2}
          distance={0}
          penumbra={0.55}
          intensity={0}
          shadow-mapSize={[shadowSize.spot, shadowSize.spot]}
          shadow-bias={-0.0006}
          shadow-radius={5}
          shadow-camera-near={50}
          shadow-camera-far={12000}
        />
      ))}
      {Array.from({ length: POOL_SIZE.area }, (_, i) => (
        <rectAreaLight key={`a${i}`} ref={(l) => void (areas.current[i] = l)} intensity={0} />
      ))}
    </>
  );
}

/** 深灰暈影背景（images1） */
export function vignetteTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(256, 230, 40, 256, 256, 380);
  grd.addColorStop(0, NIGHT.background.center);
  grd.addColorStop(1, NIGHT.background.edge);
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const toShape = (poly: Vec2[], holes: Vec2[][] = []) => {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
  return s;
};
/** Shape 在 (x,z) 平面、沿 −Y 擠出：頂面 y=0、底面 y=−depth */
const extrudeDown = (shapes: THREE.Shape[], depth: number, bevel = 0) => {
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  g.rotateX(Math.PI / 2);
  return g;
};

/**
 * 依建物外框的圓角底座（images1）＋底部黃色 LED 光暈：
 * 底座懸浮在地面上方，底緣一圈自發光燈條，地面上以加法混合的柔光貼圖表現光暈。
 */
export function Plinth({ footprint, inner }: { footprint: Vec2[][]; inner: Vec2[][] }) {
  const P = NIGHT.plinth;
  const geo = useMemo(() => {
    if (!footprint.length) return null;
    // ExtrudeGeometry 的倒角在上下兩面各多出 bevel → 頂面要下移 bevel，否則會蓋住地板（y=0）
    const bevel = 20;
    const body = extrudeDown(
      footprint.map((f) => toShape(f)),
      P.height - 2 * bevel,
      bevel,
    );
    body.translate(0, -2 - bevel, 0);
    // 底緣燈條：外框與內縮 45mm 之間的一圈
    const ring = extrudeDown(
      footprint.map((f, i) => toShape(f, inner[i] ? [inner[i]!] : [])),
      18,
    );
    ring.translate(0, -2 - P.height + 4, 0);
    // 地面光暈貼圖
    const xs = footprint.flat().map((p) => p[0]);
    const zs = footprint.flat().map((p) => p[1]);
    const spread = NIGHT.underglow.spread;
    const minX = Math.min(...xs) - spread;
    const minZ = Math.min(...zs) - spread;
    const W = Math.max(...xs) + spread - minX;
    const D = Math.max(...zs) + spread - minZ;
    let glow: THREE.Texture | null = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      const S = 512;
      c.width = S;
      c.height = Math.round((S * D) / W);
      const ctx = c.getContext('2d')!;
      const sx = S / W;
      ctx.filter = `blur(${Math.round(spread * sx * 0.35)}px)`;
      ctx.strokeStyle = NIGHT.underglow.color;
      ctx.lineWidth = Math.max(4, spread * sx * 0.5);
      for (const f of footprint) {
        ctx.beginPath();
        f.forEach(([x, z], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x - minX) * sx, (z - minZ) * sx));
        ctx.closePath();
        ctx.stroke();
      }
      glow = new THREE.CanvasTexture(c);
      glow.colorSpace = THREE.SRGBColorSpace;
    }
    return { body, ring, glow, glowPos: [minX + W / 2, minZ + D / 2] as const, glowSize: [W, D] as const };
  }, [footprint, inner, P.height]);
  useEffect(
    () => () => {
      geo?.body.dispose();
      geo?.ring.dispose();
      geo?.glow?.dispose();
    },
    [geo],
  );
  const mats = useMemo(
    () => ({
      // 底座側面：模擬舞台反射光的微弱自發光，維持 images1 的淺灰底座
      body: new THREE.MeshStandardMaterial({
        color: P.color,
        roughness: 0.55,
        emissive: P.color,
        emissiveIntensity: 0.28,
      }),
      strip: new THREE.MeshBasicMaterial({
        color: new THREE.Color(NIGHT.underglow.color).multiplyScalar(NIGHT.underglow.strength),
      }),
      // 地面＝舞台：不受光的暈影（等角俯視時整個背景其實是地面，images1 的灰色舞台）
      ground: new THREE.MeshBasicMaterial({ map: vignetteTexture(), color: '#ffffff' }),
    }),
    [P.color],
  );
  const glowMat = useMemo(
    () =>
      geo?.glow
        ? new THREE.MeshBasicMaterial({
            map: geo.glow,
            color: new THREE.Color('#ffffff').multiplyScalar(NIGHT.underglow.decal),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        : null,
    [geo],
  );
  useEffect(
    () => () => {
      mats.ground.map?.dispose();
      Object.values(mats).forEach((m) => m.dispose());
      glowMat?.dispose();
    },
    [mats, glowMat],
  );
  if (!geo) return null;
  const groundY = -2 - P.height - P.gap;
  return (
    <>
      <mesh
        geometry={geo.body}
        material={mats.body}
        receiveShadow
        castShadow
        userData={{ gkind: 'board', id: 'board' }}
      />
      <mesh geometry={geo.ring} material={mats.strip} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[geo.glowPos[0], groundY, geo.glowPos[1]]}
        material={mats.ground}
      >
        <planeGeometry args={[geo.glowSize[0] * 6, geo.glowSize[1] * 6]} />
      </mesh>
      {glowMat && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[geo.glowPos[0], groundY + 2, geo.glowPos[1]]}
          material={glowMat}
          renderOrder={1}
        >
          <planeGeometry args={[geo.glowSize[0], geo.glowSize[1]]} />
        </mesh>
      )}
    </>
  );
}

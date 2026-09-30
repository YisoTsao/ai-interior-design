import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { LightSource } from './lighting.js';

/**
 * 調色＋暗角（遊戲感後處理；在色調映射之後的顯示空間運作）。
 * 對比與飽和度微調、畫面邊緣壓暗，讓視線集中在中央模型上。
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.35 },
    saturation: { value: 1.06 },
    contrast: { value: 1.05 },
    warmth: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col += vec3(warmth, warmth * 0.4, -warmth);
      float v = smoothstep(0.95, 0.25, length((vUv - 0.5) * vec2(1.15, 1.0)));
      col *= mix(1.0, v, vignette);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

const beamVS = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vT = clamp(-position.y / max(1.0, uHeight), 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal;
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
// HDR 管線（HalfFloat）＋ bloom 會把任何 NaN 擴散到整個畫面 → 所有運算都要防 0 長度與負底數
const beamFS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // 越遠越淡（散射隨光強度的平方反比衰減），錐面邊緣淡出
    float fall = pow(max(1.0 - vT, 1e-4), 2.2) * smoothstep(1.0, 0.7, vT) * smoothstep(0.0, 0.06, vT);
    float nl = max(length(vN), 1e-4);
    float vl = max(length(vV), 1e-4);
    float edge = pow(clamp(abs(dot(vN / nl, vV / vl)), 1e-4, 1.0), 1.4);
    vec3 c = max(uColor * (uStrength * fall * edge), vec3(0.0));
    gl_FragColor = vec4(min(c, vec3(4.0)), 1.0);
  }`;

/**
 * 體積光束（假體積散射）：聚光燈沿光束方向的加法混合圓錐。只是視覺提示空氣中的微粒散射，
 * 不參與照明計算；強度與光源的發光強度成正比（ADR-023）。
 */
export function LightBeams({ spots, scale }: { spots: readonly LightSource[]; scale: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const beams = useMemo(
    () =>
      spots.flatMap((l) => {
        const dir = new THREE.Vector3(...l.direction).normalize();
        // 只有窄光束（≤ 60°，投射燈／軌道燈）才有明顯的光柱；寬角崁燈的散射是均勻的霧，不畫
        if (dir.y > -0.15 || (l.beamDeg ?? 60) > 60) return [];
        // 光束止於地面前（避免錐底穿出地板／底座）
        const height = Math.min(3000, Math.max(300, (l.position[1] / Math.max(0.2, -dir.y)) * 0.92));
        const half = (((l.beamDeg ?? 60) / 2) * Math.PI) / 180;
        const radius = Math.min(2500, height * Math.tan(half) * 0.85);
        const g = new THREE.ConeGeometry(radius, height, 32, 1, true);
        g.translate(0, -height / 2, 0);
        // 圓錐頂點在原點、朝 −Y；旋轉到光束方向
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        const m = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(l.color) },
            uStrength: { value: Math.min(0.12, (l.lumens / 900) * 0.035 * (scale / 0.03)) },
            uHeight: { value: height },
          },
          vertexShader: `uniform float uHeight;\n${beamVS}`,
          fragmentShader: beamFS,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        return [{ id: l.id, g, m, pos: l.position, q }];
      }),
    [spots, scale],
  );
  useEffect(() => {
    invalidate();
    return () => beams.forEach((b) => (b.g.dispose(), b.m.dispose()));
  }, [beams, invalidate]);
  return (
    <>
      {beams.map((b) => (
        <mesh
          key={b.id}
          geometry={b.g}
          material={b.m}
          position={b.pos}
          quaternion={b.q}
          renderOrder={2}
          raycast={() => null}
        />
      ))}
    </>
  );
}

/** 選取燈具時的光源示意：聚光＝光束錐線框、點光＝光球、面光＝發光面外框與法線 */
export function LightGizmo({ light, color }: { light: LightSource; color: string }) {
  const obj = useMemo(() => {
    const grp = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
    const dir = new THREE.Vector3(...light.direction).normalize();
    if (light.kind === 'spot') {
      const len = 1400;
      const r = len * Math.tan((((light.beamDeg ?? 60) / 2) * Math.PI) / 180);
      const cone = new THREE.EdgesGeometry(
        new THREE.ConeGeometry(r, len, 16, 1, true).translate(0, -len / 2, 0),
      );
      const lines = new THREE.LineSegments(cone, mat);
      lines.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      grp.add(lines);
    } else if (light.kind === 'point') {
      const ring = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(160, 1));
      grp.add(new THREE.LineSegments(ring, mat));
    } else if (light.size) {
      const rect = new THREE.EdgesGeometry(new THREE.PlaneGeometry(light.size.w, light.size.h));
      const l = new THREE.LineSegments(rect, mat);
      l.up.set(...(light.up ?? [0, 1, 0]));
      l.lookAt(dir);
      grp.add(l);
    }
    const arrow = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      dir.clone().multiplyScalar(600),
    ]);
    grp.add(new THREE.Line(arrow, mat));
    grp.traverse((o) => ((o.renderOrder = 10), (o.raycast = () => undefined)));
    return grp;
  }, [light, color]);
  useEffect(
    () => () =>
      obj.traverse((o) => {
        if (o instanceof THREE.LineSegments || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      }),
    [obj],
  );
  return <primitive object={obj} position={light.position} />;
}

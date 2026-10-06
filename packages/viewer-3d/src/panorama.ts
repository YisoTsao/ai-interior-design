import * as THREE from 'three';

/**
 * 720° 全景（FE-RND-02）：在指定位置以 CubeCamera 拍六面（HDR），再以著色器轉成 2:1 等距柱狀（equirectangular）PNG，
 * 並在著色器內做 ACES 色調映射與 sRGB 編碼（渲染到 render target 時 three 不會套用輸出轉換）。
 * 經度 0 朝 −Z，向右（順時針俯視）為正；緯度向上為正——與 PanoramaViewer 的球面對應一致。
 */
export function renderPanorama(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  position: THREE.Vector3,
  o: { width?: number; cubeSize?: number; exposure?: number; near?: number; far?: number } = {},
): string {
  const width = o.width ?? 4096;
  const height = width / 2;
  const cubeRT = new THREE.WebGLCubeRenderTarget(o.cubeSize ?? Math.min(2048, width / 3), {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const cam = new THREE.CubeCamera(o.near ?? 50, o.far ?? 500_000, cubeRT);
  cam.position.copy(position);
  scene.add(cam);
  const prevTarget = gl.getRenderTarget();
  try {
    cam.update(gl, scene);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tCube: { value: cubeRT.texture },
        exposure: { value: o.exposure ?? gl.toneMappingExposure },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform samplerCube tCube; uniform float exposure; varying vec2 vUv;
        vec3 fit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
        vec3 aces(vec3 c){
          const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
          const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
          c *= exposure / 0.6; c = O * fit(I * c); return clamp(c, 0.0, 1.0);
        }
        vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c)); }
        void main(){
          float lon = (vUv.x - 0.5) * 6.28318530718;
          float lat = (vUv.y - 0.5) * 3.14159265359;
          vec3 dir = vec3(sin(lon)*cos(lat), sin(lat), -cos(lon)*cos(lat));
          vec3 c = textureCube(tCube, dir).rgb;
          c = max(c, vec3(0.0));
          gl_FragColor = vec4(srgb(aces(c)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const s2 = new THREE.Scene();
    s2.add(quad);
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType });
    gl.setRenderTarget(rt);
    gl.render(s2, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const px = new Uint8Array(width * height * 4);
    gl.readRenderTargetPixels(rt, 0, 0, width, height, px);
    rt.dispose();
    quad.geometry.dispose();
    mat.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    const row = width * 4;
    // WebGL 讀出的列由下而上 → 翻轉
    for (let y = 0; y < height; y++)
      img.data.set(px.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    gl.setRenderTarget(prevTarget);
    scene.remove(cam);
    cubeRT.dispose();
  }
}

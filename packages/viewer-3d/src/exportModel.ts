import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

/** 只匯出建築與家具（牆、地板、天花、門窗、物件）；略過燈光、輔助線、底座、選取框 */
const KEEP = new Set(['wall', 'floor', 'ceiling', 'object', 'opening']);

function exportable(scene: THREE.Scene): THREE.Group {
  const root = new THREE.Group();
  root.name = 'InteriorAI';
  // mm → m（glTF／OBJ 慣例單位為公尺）
  root.scale.setScalar(0.001);
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.visible) return;
    // 物件的 gkind 可能標在祖先群組上
    let k: string | undefined;
    for (let p: THREE.Object3D | null = o; p && !k; p = p.parent) k = p.userData.gkind as string | undefined;
    if (!k || !KEEP.has(k)) return;
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        const c = new THREE.Mesh(inst.geometry, inst.material);
        c.matrixAutoUpdate = false;
        c.matrix.copy(inst.matrixWorld).multiply(m);
        c.name = `${k}_${i}`;
        root.add(c);
      }
      return;
    }
    const c = new THREE.Mesh(mesh.geometry, mesh.material);
    c.matrixAutoUpdate = false;
    c.matrix.copy(mesh.matrixWorld);
    c.name = mesh.name || k;
    root.add(c);
  });
  return root;
}

/** 3D 模型匯出（FE-DOC-04）：GLB（含材質顏色／貼圖）或 OBJ（幾何） */
export async function exportScene(scene: THREE.Scene, format: 'glb' | 'obj'): Promise<Blob> {
  const root = exportable(scene);
  if (format === 'obj') {
    const text = new OBJExporter().parse(root);
    return new Blob([text], { type: 'text/plain' });
  }
  const buf = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  return new Blob([buf], { type: 'model/gltf-binary' });
}

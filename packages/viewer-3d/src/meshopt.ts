// three 的 meshoptimizer 簡化器沒有型別宣告；在這裡補上用到的部分
// @ts-expect-error 無型別宣告（three/examples/jsm/libs）
import { MeshoptSimplifier as M } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

export const MeshoptSimplifier = M as {
  ready: Promise<void>;
  simplify(
    indices: Uint32Array,
    positions: Float32Array,
    stride: number,
    targetIndexCount: number,
    targetError: number,
    flags?: string[],
  ): [Uint32Array, number];
};

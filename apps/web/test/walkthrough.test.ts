import { describe, expect, it } from 'vitest';
import { cameraAt, pathDuration, pickVideoType, type CamKey } from '../src/editor/walkthrough';

const k = (x: number, fov = 50): CamKey => ({ position: [x, 1600, 0], target: [x, 1600, 1000], fovDeg: fov });

describe('漫遊路徑（FE-RND-06）', () => {
  const keys = [k(0, 40), k(1000, 60), k(3000)];
  it('時長與首尾夾值', () => {
    expect(pathDuration(keys, 2)).toBe(4);
    expect(cameraAt(keys, 2, -1)!.position[0]).toBe(0);
    expect(cameraAt(keys, 2, 99)!.position[0]).toBe(3000);
  });
  it('段落中點為緩動中點；關鍵幀時刻剛好到位', () => {
    expect(cameraAt(keys, 2, 1)!.position[0]).toBeCloseTo(500);
    expect(cameraAt(keys, 2, 2)!.position[0]).toBeCloseTo(1000);
    expect(cameraAt(keys, 2, 1)!.fovDeg).toBeCloseTo(50);
    expect(cameraAt(keys, 2, 3)!.position[0]).toBeCloseTo(2000);
  });
  it('錄影格式：MP4 優先，退回 WebM', () => {
    expect(pickVideoType((t) => t.startsWith('video/mp4'))?.ext).toBe('mp4');
    expect(pickVideoType((t) => t === 'video/webm')).toEqual({ mime: 'video/webm', ext: 'webm' });
    expect(pickVideoType(() => false)).toBeNull();
  });
});

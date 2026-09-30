import { describe, expect, it } from 'vitest';
import { cropRect, cssFilter, DEFAULT_EDIT, tempTint } from '../src/editor/photoEdit';

describe('photoEdit', () => {
  it('裁切置中、最大面積', () => {
    expect(cropRect(1920, 1080, '1:1')).toEqual([420, 0, 1080, 1080]);
    expect(cropRect(1000, 1000, '16:9')).toEqual([0, 219, 1000, 563]);
    expect(cropRect(800, 600, 'original')).toEqual([0, 0, 800, 600]);
  });
  it('曝光 +1 EV = 亮度 ×2；色溫 0 不疊色', () => {
    expect(cssFilter({ ...DEFAULT_EDIT, exposure: 1 })).toContain('brightness(2)');
    expect(tempTint(0)).toBeNull();
    expect(tempTint(100)).toMatch(/^rgb\(255,/);
  });
});

import { describe, expect, it } from 'vitest';
import { IesError, parseIes, polarPath } from '../src/ai/ies';

const ies = (vert: number[], cd: (deg: number) => number, extra = '') =>
  [
    'IESNA:LM-63-2002',
    '[MANUFAC] Test',
    '[LUMCAT] T-1',
    extra,
    'TILT=NONE',
    `1 -1 1 ${vert.length} 1 1 2 0.1 0.1 0`,
    '1.0 1.0 10',
    vert.join(' '),
    '0',
    vert.map((v) => cd(v).toFixed(3)).join(' '),
  ].join('\n');
const range = (a: number, b: number, s: number) =>
  Array.from({ length: (b - a) / s + 1 }, (_, i) => a + i * s);

describe('IES 解析（FE-LGT-04）', () => {
  it('朗伯體下照燈：Φ ≈ π·I0、光束角 ≈ 120°、場角 ≈ 169°', () => {
    const d = parseIes(ies(range(0, 90, 2.5), (v) => 1000 * Math.cos((v * Math.PI) / 180)));
    expect(d.keywords.MANUFAC).toBe('Test');
    expect(d.peakCd).toBe(1000);
    expect(Math.abs(d.lumens - Math.PI * 1000) / (Math.PI * 1000)).toBeLessThan(0.01);
    expect(Math.abs(d.beamDeg - 120)).toBeLessThanOrEqual(1);
    expect(d.fieldDeg).toBeGreaterThan(160);
  });
  it('窄光束聚光（高斯）', () => {
    const d = parseIes(ies(range(0, 90, 1), (v) => 5000 * Math.exp(-((v / 12) ** 2))));
    // 半寬：exp(-(θ/12)^2)=0.5 → θ≈9.99° → 光束角約 20°
    expect(Math.abs(d.beamDeg - 20)).toBeLessThanOrEqual(1);
    expect(d.lumens).toBeGreaterThan(300);
    expect(polarPath(d)).toMatch(/^M0\.000,1\.000/);
  });
  it('不是 IES 或資料不完整時丟出 IesError', () => {
    expect(() => parseIes('hello')).toThrow(IesError);
    expect(() => parseIes('IESNA:LM-63\nTILT=NONE\n1 -1 1 5 1')).toThrow(IesError);
  });
});

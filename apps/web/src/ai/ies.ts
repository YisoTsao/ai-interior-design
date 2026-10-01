/**
 * IES 光域網（IESNA LM-63，FE-LGT-04）解析：讀出垂直角、水平角與燭光值，推算
 * 總光通量（lm）、峰值燭光、光束角（≥ 50% 峰值）與場角（≥ 10% 峰值）。
 * 檢視器以聚光燈近似配光（WebGL 沒有 IES 光源），所以只寫回光通量與光束角；配光曲線在介面預覽。
 */
export interface IesData {
  keywords: Record<string, string>;
  vertical: number[];
  horizontal: number[];
  /** candela[h][v]（已乘倍率） */
  candela: number[][];
  lumens: number;
  peakCd: number;
  beamDeg: number;
  fieldDeg: number;
}

export class IesError extends Error {}

export function parseIes(text: string): IesData {
  const lines = text.replace(/\r/g, '').split('\n');
  if (!/^IESNA/i.test(lines[0] ?? '') && !lines.some((l) => /^TILT=/i.test(l))) throw new IesError('NOT_IES');
  const keywords: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    const m = /^\[(\w+)\]\s*(.*)$/.exec(l);
    if (m) keywords[m[1]!.toUpperCase()] = m[2]!;
    if (/^TILT=/i.test(l)) {
      if (!/^TILT=NONE/i.test(l)) {
        // TILT=INCLUDE：跳過 4 段傾斜資料（燈具幾何、角度數、角度、倍率）
        const rest = lines
          .slice(i + 1)
          .join(' ')
          .trim()
          .split(/[\s,]+/);
        const n = Number(rest[1]);
        i += 1;
        const skip = 2 + 2 * n;
        const nums = lines
          .slice(i)
          .join(' ')
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean);
        return parseNumbers(nums.slice(skip), keywords);
      }
      i++;
      break;
    }
  }
  const nums = lines
    .slice(i)
    .join(' ')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  return parseNumbers(nums, keywords);
}

function parseNumbers(tokens: string[], keywords: Record<string, string>): IesData {
  const n = tokens.map(Number);
  if (n.length < 13 || n.some((x) => !Number.isFinite(x))) throw new IesError('BAD_NUMBERS');
  const [, lumensPerLamp, multiplier, nV, nH] = n as [number, number, number, number, number];
  let k = 13;
  const vertical = n.slice(k, (k += nV));
  const horizontal = n.slice(k, (k += nH));
  const candela: number[][] = [];
  for (let h = 0; h < nH; h++) candela.push(n.slice(k, (k += nV)).map((c) => c * (multiplier || 1)));
  if (vertical.length !== nV || horizontal.length !== nH || candela.some((r) => r.length !== nV))
    throw new IesError('TRUNCATED');
  // 以各水平角平均的垂直分佈計算
  const avg = vertical.map((_, v) => candela.reduce((a, r) => a + r[v]!, 0) / Math.max(1, nH));
  const peakCd = Math.max(...avg, 0);
  // 光通量：Φ = Σ I(θ)·2π·(cos θ1 − cos θ2)（旋轉對稱近似）
  let flux = 0;
  for (let v = 0; v < nV - 1; v++) {
    const t1 = (vertical[v]! * Math.PI) / 180;
    const t2 = (vertical[v + 1]! * Math.PI) / 180;
    flux += ((avg[v]! + avg[v + 1]!) / 2) * 2 * Math.PI * (Math.cos(t1) - Math.cos(t2));
  }
  const lumens = Math.round(Math.abs(flux) || Math.max(0, lumensPerLamp));
  const angleAt = (frac: number) => {
    const target = peakCd * frac;
    for (let v = 0; v < nV; v++)
      if (avg[v]! < target) {
        if (v === 0) return 0;
        const a0 = vertical[v - 1]!;
        const a1 = vertical[v]!;
        const c0 = avg[v - 1]!;
        const c1 = avg[v]!;
        return a0 + ((c0 - target) / Math.max(1e-9, c0 - c1)) * (a1 - a0);
      }
    return vertical[nV - 1]!;
  };
  return {
    keywords,
    vertical,
    horizontal,
    candela,
    lumens,
    peakCd: Math.round(peakCd),
    beamDeg: Math.round(Math.min(170, 2 * angleAt(0.5))),
    fieldDeg: Math.round(Math.min(170, 2 * angleAt(0.1))),
  };
}

/** 極座標配光曲線（SVG path，中心在 (0,0)、半徑 1，往下為 0°） */
export function polarPath(d: IesData): string {
  const avg = d.vertical.map(
    (_, v) => d.candela.reduce((a, r) => a + r[v]!, 0) / Math.max(1, d.candela.length),
  );
  const pk = Math.max(...avg, 1e-9);
  const pts = d.vertical.map((deg, v) => {
    const a = (deg * Math.PI) / 180;
    const r = avg[v]! / pk;
    return [Math.sin(a) * r, Math.cos(a) * r] as const;
  });
  const right = pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`);
  const left = [...pts].reverse().map(([x, y]) => `${(-x).toFixed(3)},${y.toFixed(3)}`);
  return `M${[...right, ...left].join(' L')} Z`;
}

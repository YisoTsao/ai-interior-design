/**
 * VisionProvider（05 §1、06 §3-5）：只補「語意標籤」（房名），不得改動幾何。
 * 真實供應商（models.yaml providers.openai.vision）尚未核對 → 未驗證；預設確定性 mock：
 * - 有 OCR/DXF 文字的房間：英中對照正規化（LIVING→客廳…）
 * - 沒有文字的房間：依面積啟發式（最大＝客廳、< 5 m²＝浴室、其餘＝臥室），信心 0.5
 */
export interface RoomForLabel {
  index: number;
  areaM2: number | null;
  ocrLabel: string | null;
}
export interface RoomLabel {
  index: number;
  label: string;
  confidence: number;
  source: 'ocr' | 'vlm' | 'heuristic';
}
export interface VisionProvider {
  readonly id: string;
  labelRooms(rooms: RoomForLabel[], signal: AbortSignal): Promise<RoomLabel[]>;
}

const CANON: [RegExp, string][] = [
  [/living|lounge|客廳|起居/i, '客廳'],
  [/dining|餐廳/i, '餐廳'],
  [/kitchen|廚房/i, '廚房'],
  [/bath|toilet|wc|浴|廁|衛/i, '浴室'],
  [/master|主臥/i, '主臥'],
  [/bed|臥|房間/i, '臥室'],
  [/study|office|書房/i, '書房'],
  [/balcony|陽台/i, '陽台'],
];

export const canonicalRoomLabel = (s: string) => CANON.find(([re]) => re.test(s))?.[1] ?? s;

export class MockVisionProvider implements VisionProvider {
  readonly id = 'mock-vision';
  async labelRooms(rooms: RoomForLabel[]): Promise<RoomLabel[]> {
    const withArea = rooms.filter((r) => r.areaM2 !== null);
    const largest = withArea.length ? withArea.reduce((a, b) => (b.areaM2! > a.areaM2! ? b : a)) : null;
    return rooms.map((r) => {
      if (r.ocrLabel)
        return { index: r.index, label: canonicalRoomLabel(r.ocrLabel), confidence: 0.85, source: 'ocr' };
      if (largest && r.index === largest.index)
        return { index: r.index, label: '客廳', confidence: 0.5, source: 'heuristic' };
      if (r.areaM2 !== null && r.areaM2 < 5)
        return { index: r.index, label: '浴室', confidence: 0.5, source: 'heuristic' };
      return { index: r.index, label: '臥室', confidence: 0.45, source: 'heuristic' };
    });
  }
}

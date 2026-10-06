import { PlanParseError } from './types.js';

/** 依檔頭判斷格式（與 cv-service 的 _kind_of 相同規則） */
export function detectKind(head: Uint8Array, filename: string): 'raster' | 'vector' {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47]) || starts([0xff, 0xd8, 0xff]) || starts([0x52, 0x49, 0x46, 0x46]))
    return 'raster';
  const text = String.fromCharCode(...head.slice(0, 32));
  if (/\.dwg$/i.test(filename) || text.startsWith('AC10'))
    throw new PlanParseError('UPLOAD_REJECTED', 'DWG 不支援（授權與沙箱限制），請轉存為 DXF');
  if (text.startsWith('%PDF'))
    throw new PlanParseError('UPLOAD_REJECTED', 'PDF 平面圖尚未支援，請轉為 DXF 或 PNG/JPG');
  if (text.startsWith('AutoCAD Binary DXF'))
    throw new PlanParseError('UPLOAD_REJECTED', '二進位 DXF 不支援，請另存為 ASCII DXF');
  if (/\.dxf$/i.test(filename) || text.trimStart().startsWith('0')) return 'vector';
  throw new PlanParseError('UPLOAD_REJECTED', '無法辨識的檔案格式');
}

/**
 * 上傳白名單（B7：型別白名單、大小上限、格式檢查）。純函式，單元測試覆蓋。
 * DWG 預設拒絕：解析需第三方轉檔（授權/沙箱問題，06、ADR-015），請使用者轉成 DXF。
 */
export type UploadKind = 'plan' | 'photo' | 'gbuffer' | 'asset' | 'other';
type Sniff = 'png' | 'jpeg' | 'webp' | 'pdf' | 'dxf' | 'glb';

const MB = 1024 * 1024;
const MIME: Record<string, Sniff> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/dxf': 'dxf',
  'image/vnd.dxf': 'dxf',
  'image/x-dxf': 'dxf',
  'model/gltf-binary': 'glb',
};
const RULES: Record<UploadKind, { types: Sniff[]; maxBytes: number }> = {
  plan: { types: ['png', 'jpeg', 'webp', 'pdf', 'dxf'], maxBytes: 30 * MB },
  photo: { types: ['png', 'jpeg', 'webp'], maxBytes: 20 * MB },
  gbuffer: { types: ['png'], maxBytes: 25 * MB },
  asset: { types: ['glb', 'png', 'jpeg', 'webp'], maxBytes: 50 * MB },
  other: { types: ['png', 'jpeg', 'pdf'], maxBytes: 10 * MB },
};

export type PolicyResult = { ok: true; type: Sniff } | { ok: false; reason: string };

export function checkDeclared(kind: UploadKind, filename: string, mime: string, size: number): PolicyResult {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'dwg' || /dwg|acad/i.test(mime))
    return { ok: false, reason: 'DWG 目前不支援（授權與沙箱限制），請轉存為 DXF 後上傳' };
  const type = MIME[mime.toLowerCase()];
  const rule = RULES[kind];
  if (!type || !rule.types.includes(type)) return { ok: false, reason: `此用途（${kind}）不接受 ${mime}` };
  if (size > rule.maxBytes) return { ok: false, reason: `檔案超過 ${rule.maxBytes / MB} MB 上限` };
  return { ok: true, type };
}

/** 依檔頭判斷實際格式（不信任用戶端宣告的 mime） */
export function sniff(head: Buffer): Sniff | null {
  const s = head.toString('latin1');
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.startsWith('%PDF-')) return 'pdf';
  if (s.startsWith('glTF')) return 'glb';
  if (s.startsWith('AutoCAD Binary DXF') || /^\s*0\s*\r?\n\s*SECTION/.test(s)) return 'dxf';
  return null;
}

export const safeFilename = (f: string) =>
  f
    .normalize('NFKC')
    .replace(/[^\w.\-一-鿿]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';

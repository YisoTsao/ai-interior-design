import { inflateSync } from 'node:zlib';

/** 測試用最小 PNG 解碼（8-bit；灰階／RGB／RGBA／灰階+α；不支援交錯） */
export function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let p = 8;
  let width = 0;
  let height = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + n;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct as 0 | 2 | 4 | 6];
  if (!ch) throw new Error('unsupported color type');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = px.subarray(i * ch, i * ch + ch);
    const [r, g, b] = ch >= 3 ? [s[0], s[1], s[2]] : [s[0], s[0], s[0]];
    rgba.set([r, g, b, ch === 4 ? s[3] : ch === 2 ? s[1] : 255], i * 4);
  }
  return { width, height, rgba };
}

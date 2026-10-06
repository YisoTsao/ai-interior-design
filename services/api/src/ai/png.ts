import { crc32 } from 'node:zlib';
import { PNG } from 'pngjs';
import type { RGBA } from '@interiorai/image-ops';

export function decodePng(buf: Buffer): RGBA {
  const p = PNG.sync.read(buf);
  return {
    width: p.width,
    height: p.height,
    data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length),
  };
}

/**
 * PNG 編碼；text 會寫成 tEXt chunk（AI 生成標示，B6.2-6：中繼資料層）。
 */
export function encodePng(img: RGBA, text: Record<string, string> = {}): Buffer {
  const p = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).copy(p.data);
  const png = PNG.sync.write(p);
  const entries = Object.entries(text);
  if (!entries.length) return png;
  const iend = png.length - 12;
  const chunks = entries.map(([k, v]) => {
    const data = Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')]);
    const type = Buffer.from('tEXt', 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
    return Buffer.concat([len, type, data, crc]);
  });
  return Buffer.concat([png.subarray(0, iend), ...chunks, png.subarray(iend)]);
}

/** 讀出 tEXt chunks（測試/稽核用） */
export function readPngText(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (type === 'tEXt') {
      const d = buf.subarray(i + 8, i + 8 + len);
      const z = d.indexOf(0);
      out[d.toString('latin1', 0, z)] = d.toString('latin1', z + 1);
    }
    i += 12 + len;
  }
  return out;
}

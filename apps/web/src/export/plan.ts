import { objectDims, type Catalog } from '@interiorai/catalog';
import { detectRooms, objectFootprint, openingSegment, wallQuad, type Vec2 } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';

/**
 * 平面圖匯出（FE-DOC-04）：DXF（R12 ASCII，mm，圖層：WALLS／DOORS／WINDOWS／FURNITURE／ROOMS／TEXT）與 SVG。
 * 座標：DXF 的 Y 軸向上 → 以 −z 輸出，讓圖面方向與 2D 編輯器一致。
 */
export const DXF_LAYERS = ['WALLS', 'DOORS', 'WINDOWS', 'FURNITURE', 'ROOMS', 'TEXT'] as const;
type Layer = (typeof DXF_LAYERS)[number];
const LAYER_COLOR: Record<Layer, number> = {
  WALLS: 7,
  DOORS: 1,
  WINDOWS: 5,
  FURNITURE: 3,
  ROOMS: 8,
  TEXT: 2,
};

const num = (v: number) => (Math.round(v * 100) / 100).toString();

export function planToDxf(level: Level, catalog: Catalog): string {
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? num(v) : v);
  const line = (layer: Layer, a: Vec2, b: Vec2) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, a[0]);
    g(20, -a[1]);
    g(30, 0);
    g(11, b[0]);
    g(21, -b[1]);
    g(31, 0);
  };
  const poly = (layer: Layer, pts: readonly Vec2[]) =>
    pts.forEach((p, i) => line(layer, p, pts[(i + 1) % pts.length]!));
  const text = (layer: Layer, p: Vec2, h: number, s: string) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, p[0]);
    g(20, -p[1]);
    g(30, 0);
    g(40, h);
    g(1, s.replace(/[\r\n]+/g, ' '));
    g(72, 1); // 水平置中
    g(11, p[0]);
    g(21, -p[1]);
    g(31, 0);
  };
  // HEADER：單位 mm
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(0, 'ENDSEC');
  // TABLES：圖層
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, DXF_LAYERS.length);
  for (const l of DXF_LAYERS) {
    g(0, 'LAYER');
    g(2, l);
    g(70, 0);
    g(62, LAYER_COLOR[l]);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const w of level.walls) poly('WALLS', wallQuad(level.walls, w));
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const [p, q] = openingSegment(w, o.offset, o.width);
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const n: Vec2 = [(-(q[1] - p[1]) / L) * (w.thickness / 2), ((q[0] - p[0]) / L) * (w.thickness / 2)];
    const layer: Layer = o.type === 'window' ? 'WINDOWS' : 'DOORS';
    poly(layer, [
      [p[0] + n[0], p[1] + n[1]],
      [q[0] + n[0], q[1] + n[1]],
      [q[0] - n[0], q[1] - n[1]],
      [p[0] - n[0], p[1] - n[1]],
    ]);
    if (o.type === 'window') line(layer, p, q);
    else if (o.type === 'door') {
      // 門片：由鉸鏈端垂直展開
      const hinge = o.swing === 'right' ? q : p;
      line(layer, hinge, [
        hinge[0] + (n[0] / (w.thickness / 2)) * o.width,
        hinge[1] + (n[1] / (w.thickness / 2)) * o.width,
      ]);
    }
  }
  for (const o of level.objects) {
    const e = catalog.get(o.catalogId);
    if (!e || e.anchor === 'ceiling' || o.appearance?.hidden) continue;
    const d = objectDims(e, o.params, o.scale);
    poly('FURNITURE', objectFootprint(o.position, o.rotationY, d.w, d.d));
  }
  const det = detectRooms(level).rooms;
  for (const r of level.rooms) {
    const d = det.find((x) => x.key === [...r.wallIds].sort().join('|'));
    if (!d) continue;
    const c: Vec2 = [
      d.floor.reduce((s, p) => s + p[0], 0) / d.floor.length,
      d.floor.reduce((s, p) => s + p[1], 0) / d.floor.length,
    ];
    text('ROOMS', c, 250, `${r.label ?? ''} ${(d.netArea / 1e6).toFixed(2)} m2`.trim());
  }
  for (const a of level.annotations ?? []) {
    const dd = (a.data ?? {}) as { position?: Vec2; text?: string; size?: number };
    if (a.type === 'text' && dd.position && dd.text) text('TEXT', dd.position, dd.size ?? 250, dd.text);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** SVG 平面圖（彩色：房間依用途填色、牆黑、家具淺灰＋名稱） */
export function planToSvg(
  level: Level,
  catalog: Catalog,
  o: {
    nameOf: (catalogId: string) => string;
    roomFill?: (kind: string | undefined) => string;
    /** 依房間填色（優先於 roomFill；例如地坪圖依地板材質） */
    roomFillOf?: (room: Level['rooms'][number]) => string;
    /** 房間第二行文字（預設面積） */
    roomSub?: (room: Level['rooms'][number], areaM2: number) => string;
    title?: string;
    /** 家具（預設顯示） */
    furniture?: boolean | ((catalogId: string) => boolean);
    /** 外框總尺寸線 */
    dims?: boolean;
    /** 額外 SVG 元素（畫在最上層；世界座標 mm） */
    extra?: string[];
  },
): string {
  const pts = level.walls.flatMap((w) => [w.a, w.b]);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const pad = o.dims ? 1600 : 800;
  const [x0, x1, z0, z1] = xs.length
    ? [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad]
    : [-5000, 5000, -5000, 5000];
  const P = (ps: readonly Vec2[]) => ps.map((p) => `${num(p[0])},${num(p[1])}`).join(' ');
  const fill = o.roomFill ?? (() => '#f3efe7');
  const parts: string[] = [];
  const det = detectRooms(level).rooms;
  for (const r of level.rooms) {
    const d = det.find((x) => x.key === [...r.wallIds].sort().join('|'));
    if (d)
      parts.push(`<polygon points="${P(d.floor)}" fill="${o.roomFillOf ? o.roomFillOf(r) : fill(r.kind)}"/>`);
  }
  for (const ob of level.objects) {
    const e = catalog.get(ob.catalogId);
    if (!e || e.anchor === 'ceiling' || ob.appearance?.hidden) continue;
    if (o.furniture === false || (typeof o.furniture === 'function' && !o.furniture(ob.catalogId))) continue;
    const d = objectDims(e, ob.params, ob.scale);
    const fp = objectFootprint(ob.position, ob.rotationY, d.w, d.d);
    parts.push(
      `<polygon points="${P(fp)}" fill="#ffffff" fill-opacity="0.85" stroke="#8a8f98" stroke-width="15"/>`,
    );
    if (d.w >= 500 && d.d >= 400)
      parts.push(
        `<text x="${num(ob.position[0])}" y="${num(ob.position[2])}" font-size="110" text-anchor="middle" dominant-baseline="middle" fill="#555">${esc(o.nameOf(ob.catalogId))}</text>`,
      );
  }
  for (const w of level.walls) parts.push(`<polygon points="${P(wallQuad(level.walls, w))}" fill="#222"/>`);
  for (const op of level.openings) {
    const w = level.walls.find((x) => x.id === op.wallId);
    if (!w) continue;
    const [p, q] = openingSegment(w, op.offset, op.width);
    parts.push(
      `<line x1="${num(p[0])}" y1="${num(p[1])}" x2="${num(q[0])}" y2="${num(q[1])}" stroke="#fff" stroke-width="${w.thickness + 4}"/>`,
    );
    parts.push(
      `<line x1="${num(p[0])}" y1="${num(p[1])}" x2="${num(q[0])}" y2="${num(q[1])}" stroke="${op.type === 'window' ? '#3b82c4' : '#b0703a'}" stroke-width="30"/>`,
    );
  }
  for (const r of level.rooms) {
    const d = det.find((x) => x.key === [...r.wallIds].sort().join('|'));
    if (!d) continue;
    const cx = d.floor.reduce((s, p) => s + p[0], 0) / d.floor.length;
    const cz = d.floor.reduce((s, p) => s + p[1], 0) / d.floor.length;
    parts.push(
      `<text x="${num(cx)}" y="${num(cz - 150)}" font-size="220" font-weight="700" text-anchor="middle" fill="#333">${esc(r.label ?? '')}</text>`,
      `<text x="${num(cx)}" y="${num(cz + 150)}" font-size="150" text-anchor="middle" fill="#666">${esc(o.roomSub ? o.roomSub(r, d.netArea / 1e6) : `${(d.netArea / 1e6).toFixed(2)} m²`)}</text>`,
    );
  }
  if (o.dims && xs.length) {
    // 外框總尺寸（上方寬、左側深），含延伸線與箭頭短線
    const [bx0, bx1, bz0, bz1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const ty = bz0 - 900;
    const lx = bx0 - 900;
    const tick = (x: number, y: number) =>
      `<line x1="${x - 80}" y1="${y + 80}" x2="${x + 80}" y2="${y - 80}" stroke="#222" stroke-width="18"/>`;
    parts.push(
      `<line x1="${bx0}" y1="${ty}" x2="${bx1}" y2="${ty}" stroke="#222" stroke-width="12"/>`,
      `<line x1="${bx0}" y1="${bz0 - 150}" x2="${bx0}" y2="${ty - 150}" stroke="#222" stroke-width="8"/>`,
      `<line x1="${bx1}" y1="${bz0 - 150}" x2="${bx1}" y2="${ty - 150}" stroke="#222" stroke-width="8"/>`,
      tick(bx0, ty),
      tick(bx1, ty),
      `<text x="${num((bx0 + bx1) / 2)}" y="${ty - 120}" font-size="200" text-anchor="middle" fill="#222">${Math.round(bx1 - bx0)}</text>`,
      `<line x1="${lx}" y1="${bz0}" x2="${lx}" y2="${bz1}" stroke="#222" stroke-width="12"/>`,
      `<line x1="${bx0 - 150}" y1="${bz0}" x2="${lx - 150}" y2="${bz0}" stroke="#222" stroke-width="8"/>`,
      `<line x1="${bx0 - 150}" y1="${bz1}" x2="${lx - 150}" y2="${bz1}" stroke="#222" stroke-width="8"/>`,
      tick(lx, bz0),
      tick(lx, bz1),
      `<text x="${lx - 150}" y="${num((bz0 + bz1) / 2)}" font-size="200" text-anchor="middle" fill="#222" transform="rotate(-90 ${lx - 150} ${num((bz0 + bz1) / 2)})">${Math.round(bz1 - bz0)}</text>`,
    );
  }
  parts.push(...(o.extra ?? []));
  const title = o.title ? `<title>${esc(o.title)}</title>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" width="${Math.round((x1 - x0) / 10)}" height="${Math.round((z1 - z0) / 10)}" font-family="system-ui, 'Noto Sans TC', sans-serif">${title}
<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="#fff"/>
${parts.join('\n')}
</svg>
`;
}

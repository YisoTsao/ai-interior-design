import { objectDims, type Catalog, type Material } from '@interiorai/catalog';
import {
  closestOnSegment,
  detectRooms,
  objectFootprint,
  signedArea,
  wallLength,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';
import { MEP_LEGEND } from '@interiorai/editor-2d';
import { planToSvg } from './plan';

/**
 * 施工圖集（FE-DOC-03）：可列印的 A3 橫式 HTML（瀏覽器另存 PDF）。
 * 圖面：封面／平面尺寸圖／家具配置圖／地坪圖／天花與燈具迴路圖／水電點位圖（含圖例與離地高）／各房間立面圖。
 */
export interface DrawingText {
  t: (key: string, vars?: Record<string, string | number>) => string;
  nameOf: (catalogId: string) => string;
  matName: (id: string) => string;
  date: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const typeOf = (catalog: Catalog, id: string) => {
  const e = catalog.get(id);
  return e?.model.kind === 'parametric' ? e.model.type : '';
};
const LIGHT_TYPES = new Set([
  'lamp_downlight',
  'lamp_pendant',
  'lamp_chandelier',
  'lamp_track',
  'lamp_wall',
  'lamp_floor',
  'lamp_table',
  'led_strip',
  'led_bar',
  'light_hex',
  'lamp_arc',
  'ceiling_fan',
]);

/** 單一房間的立面：沿房間淨地板多邊形的每條邊（室內往牆看，左→右） */
export function roomElevations(level: Level, catalog: Catalog) {
  const det = detectRooms(level).rooms;
  return det.flatMap((room, ri) => {
    const r = level.rooms.find((x) => [...x.wallIds].sort().join('|') === room.key);
    const poly = room.floor;
    const ccw = signedArea(poly) > 0;
    return poly.flatMap((p0, i) => {
      const q0 = poly[(i + 1) % poly.length]!;
      const [p, q] = ccw ? [p0, q0] : [q0, p0];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 600) return [];
      const e: Vec2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      const inward: Vec2 = ccw ? [-e[1], e[0]] : [e[1], -e[0]];
      const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const wall = level.walls.find((w) => {
        const c = closestOnSegment(mid, w.a as Vec2, w.b as Vec2);
        return Math.abs(c.distance - w.thickness / 2) < 5;
      });
      const along = (v: Vec2) => (v[0] - p[0]) * e[0] + (v[1] - p[1]) * e[1];
      const openings = wall
        ? level.openings
            .filter((o) => o.wallId === wall.id)
            .map((o) => {
              const W = wallLength(wall);
              const pa: Vec2 = [
                wall.a[0] + ((wall.b[0] - wall.a[0]) * o.offset) / W,
                wall.a[1] + ((wall.b[1] - wall.a[1]) * o.offset) / W,
              ];
              const pb: Vec2 = [
                wall.a[0] + ((wall.b[0] - wall.a[0]) * (o.offset + o.width)) / W,
                wall.a[1] + ((wall.b[1] - wall.a[1]) * (o.offset + o.width)) / W,
              ];
              const [x0, x1] = [along(pa), along(pb)].sort((a, b) => a - b) as [number, number];
              return { type: o.type, x0, x1, y0: o.sill ?? 0, y1: (o.sill ?? 0) + o.height };
            })
            .filter((o) => o.x1 > 0 && o.x0 < L)
        : [];
      const objects = level.objects.flatMap((o) => {
        const ent = catalog.get(o.catalogId);
        if (!ent || o.appearance?.hidden) return [];
        const d = objectDims(ent, o.params, o.scale);
        const fp = objectFootprint(o.position, o.rotationY, d.w, d.d);
        const dist = Math.min(...fp.map((v) => (v[0] - p[0]) * inward[0] + (v[1] - p[1]) * inward[1]));
        if (dist > 700 || dist < -50) return [];
        const xs = fp.map(along);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        if (x1 < 0 || x0 > L) return [];
        return [
          {
            id: o.id,
            catalogId: o.catalogId,
            x0: Math.max(0, x0),
            x1: Math.min(L, x1),
            y0: o.position[1],
            y1: o.position[1] + d.h,
            mep: typeOf(catalog, o.catalogId) === 'mep',
            point: String(
              o.params?.point ??
                (ent.model.kind === 'parametric' ? (ent.model.params.point?.default ?? '') : ''),
            ),
          },
        ];
      });
      return [
        {
          roomId: r?.id ?? room.key,
          roomLabel: r?.label ?? `R${ri + 1}`,
          index: i + 1,
          length: Math.round(L),
          height: wall?.height ?? level.height,
          openings,
          objects,
        },
      ];
    });
  });
}

function elevationSvg(el: ReturnType<typeof roomElevations>[number], tx: DrawingText): string {
  const pad = 500;
  const W = el.length;
  const H = el.height;
  const y = (v: number) => H - v; // SVG y 向下
  const parts: string[] = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#fbfaf7" stroke="#222" stroke-width="20"/>`,
    `<line x1="-200" y1="${H}" x2="${W + 200}" y2="${H}" stroke="#222" stroke-width="30"/>`,
  ];
  for (const o of el.openings)
    parts.push(
      `<rect x="${o.x0}" y="${y(o.y1)}" width="${o.x1 - o.x0}" height="${o.y1 - o.y0}" fill="${o.type === 'window' ? '#dcebf7' : '#f3e6d6'}" stroke="${o.type === 'window' ? '#3b82c4' : '#b0703a'}" stroke-width="14"/>`,
    );
  for (const o of el.objects) {
    if (o.mep) {
      const m = MEP_LEGEND[o.point] ?? { code: '?', color: '#666' };
      const cx = (o.x0 + o.x1) / 2;
      parts.push(
        `<circle cx="${cx}" cy="${y((o.y0 + o.y1) / 2)}" r="70" fill="#fff" stroke="${m.color}" stroke-width="14"/>`,
        `<text x="${cx}" y="${y((o.y0 + o.y1) / 2) + 30}" font-size="80" text-anchor="middle" fill="${m.color}" font-weight="700">${m.code}</text>`,
        `<text x="${cx + 90}" y="${y((o.y0 + o.y1) / 2) - 70}" font-size="70" fill="#555">${Math.round(o.y0)}</text>`,
      );
      continue;
    }
    parts.push(
      `<rect x="${o.x0}" y="${y(o.y1)}" width="${Math.max(10, o.x1 - o.x0)}" height="${Math.max(10, o.y1 - o.y0)}" fill="none" stroke="#777" stroke-width="10"/>`,
    );
    if (o.x1 - o.x0 > 500)
      parts.push(
        `<text x="${(o.x0 + o.x1) / 2}" y="${y(o.y1) + 120}" font-size="90" text-anchor="middle" fill="#555">${esc(tx.nameOf(o.catalogId))}</text>`,
      );
  }
  parts.push(
    `<text x="${W / 2}" y="${H + 300}" font-size="160" text-anchor="middle" fill="#222">${W}</text>`,
    `<text x="${-250}" y="${H / 2}" font-size="160" text-anchor="middle" fill="#222" transform="rotate(-90 -250 ${H / 2})">${H}</text>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" font-family="system-ui, 'Noto Sans TC', sans-serif">${parts.join('')}</svg>`;
}

export function drawingSet(
  level: Level,
  catalog: Catalog,
  mats: ReadonlyMap<string, Material>,
  tx: DrawingText,
  projectName: string,
): string {
  const { t } = tx;
  const det = detectRooms(level).rooms;
  const roomDet = (r: Level['rooms'][number]) => det.find((d) => d.key === [...r.wallIds].sort().join('|'));
  const pages: { title: string; body: string }[] = [];
  const plan = (o: Omit<Parameters<typeof planToSvg>[2], 'nameOf'>) =>
    planToSvg(level, catalog, { nameOf: tx.nameOf, ...o }).replace(/^<\?xml[^>]*>\s*/, '');

  pages.push({ title: t('drawings.plan'), body: plan({ dims: true, furniture: false }) });
  pages.push({
    title: t('drawings.furniture'),
    body: plan({
      dims: true,
      furniture: (id) => !LIGHT_TYPES.has(typeOf(catalog, id)) && typeOf(catalog, id) !== 'mep',
    }),
  });
  // 地坪：房間依地板材質顏色填色、標示材質名稱與鋪貼
  pages.push({
    title: t('drawings.floor'),
    body: plan({
      furniture: false,
      roomFillOf: (r) => mats.get(r.floorMaterialId ?? '')?.color ?? '#eee',
      roomSub: (r, a) =>
        `${tx.matName(r.floorMaterialId ?? '')}${r.floorTiling ? ` · ${t(`tiling.patterns.${r.floorTiling.pattern}`)}` : ''} · ${a.toFixed(2)} m²`,
    }),
  });
  // 天花與燈具迴路：依房間分迴路 C1…
  const circuits = level.rooms.map((r, i) => ({ r, code: `C${i + 1}`, det: roomDet(r) }));
  const lightObjs = level.objects.filter((o) => LIGHT_TYPES.has(typeOf(catalog, o.catalogId)));
  const circuitOf = (o: Level['objects'][number]) =>
    circuits.find((c) => c.det && pointIn([o.position[0], o.position[2]], c.det.floor))?.code ?? 'C0';
  const lightMarks = lightObjs.map((o) => {
    const code = circuitOf(o);
    return `<circle cx="${o.position[0]}" cy="${o.position[2]}" r="130" fill="#fff6d6" stroke="#c98a00" stroke-width="20"/><line x1="${o.position[0] - 90}" y1="${o.position[2] - 90}" x2="${o.position[0] + 90}" y2="${o.position[2] + 90}" stroke="#c98a00" stroke-width="14"/><line x1="${o.position[0] + 90}" y1="${o.position[2] - 90}" x2="${o.position[0] - 90}" y2="${o.position[2] + 90}" stroke="#c98a00" stroke-width="14"/><text x="${o.position[0] + 160}" y="${o.position[2] - 110}" font-size="120" fill="#c98a00" font-weight="700">${code}</text>`;
  });
  const circuitRows = circuits
    .map((c) => {
      const ls = lightObjs.filter((o) => circuitOf(o) === c.code);
      const lm = ls.reduce((s, o) => s + (catalog.get(o.catalogId)?.light?.lumens ?? 0), 0);
      return ls.length
        ? `<tr><td>${c.code}</td><td>${esc(c.r.label ?? '')}</td><td>${ls.length}</td><td>${Math.round(lm)} lm</td></tr>`
        : '';
    })
    .join('');
  pages.push({
    title: t('drawings.ceiling'),
    body:
      plan({ furniture: false, roomFill: () => '#f7f7f7', extra: lightMarks }) +
      `<table><tr><th>${t('drawings.circuit')}</th><th>${t('drawings.room')}</th><th>${t('drawings.count')}</th><th>${t('drawings.flux')}</th></tr>${circuitRows}</table>`,
  });
  // 水電點位＋圖例
  const meps = level.objects.filter((o) => typeOf(catalog, o.catalogId) === 'mep');
  const pointOf = (o: Level['objects'][number]) => {
    const e = catalog.get(o.catalogId);
    return String(
      o.params?.point ?? (e?.model.kind === 'parametric' ? (e.model.params.point?.default ?? '') : ''),
    );
  };
  const mepMarks = meps.map((o) => {
    const m = MEP_LEGEND[pointOf(o)] ?? { code: '?', color: '#666' };
    return `<circle cx="${o.position[0]}" cy="${o.position[2]}" r="150" fill="#fff" stroke="${m.color}" stroke-width="24"/><text x="${o.position[0]}" y="${o.position[2] + 50}" font-size="130" font-weight="700" text-anchor="middle" fill="${m.color}">${m.code}</text><text x="${o.position[0] + 180}" y="${o.position[2] - 140}" font-size="100" fill="#555">${Math.round(o.position[1])}</text>`;
  });
  const legendRows = Object.entries(MEP_LEGEND)
    .map(([k, m]) => {
      const n = meps.filter((o) => pointOf(o) === k).length;
      return `<tr><td><b style="color:${m.color}">${m.code}</b></td><td>${esc(t(`mep.${k}`))}</td><td>${n}</td></tr>`;
    })
    .join('');
  pages.push({
    title: t('drawings.mep'),
    body:
      plan({ furniture: false, roomFill: () => '#fafafa', extra: mepMarks }) +
      `<table><tr><th>${t('drawings.symbol')}</th><th>${t('drawings.item')}</th><th>${t('drawings.count')}</th></tr>${legendRows}</table><p class=muted>${t('drawings.mepNote')}</p>`,
  });
  // 立面
  for (const el of roomElevations(level, catalog))
    pages.push({
      title: t('drawings.elevation', { room: el.roomLabel, n: el.index }),
      body: elevationSvg(el, tx),
    });

  const html = pages
    .map(
      (p, i) =>
        `<section class=page><header><b>${esc(projectName)}</b><span>${esc(p.title)}</span><span>${i + 2} / ${pages.length + 1}</span></header><div class=draw>${p.body}</div></section>`,
    )
    .join('');
  const cover = `<section class="page cover"><div class=brand>INTERIOR·AI</div><h1>${esc(t('drawings.title'))}</h1><h2>${esc(projectName)}</h2><p>${esc(tx.date)}</p><ol>${pages.map((p) => `<li>${esc(p.title)}</li>`).join('')}</ol><p class=muted>${esc(t('drawings.disclaimer'))}</p></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(projectName)} — ${esc(t('drawings.title'))}</title><style>
@page{size:A3 landscape;margin:10mm}
body{margin:0;font-family:system-ui,"Noto Sans TC",sans-serif;color:#222}
.page{page-break-after:always;height:277mm;display:flex;flex-direction:column;padding:4mm;box-sizing:border-box}
.page header{display:flex;justify-content:space-between;border-bottom:2px solid #222;padding-bottom:2mm;margin-bottom:3mm;font-size:12pt}
.draw{flex:1;display:flex;gap:6mm;min-height:0;align-items:flex-start}
.draw svg{flex:1;height:100%;max-height:250mm}
table{border-collapse:collapse;font-size:10pt;min-width:60mm}td,th{border:1px solid #bbb;padding:1.5mm 3mm;text-align:left}
.cover{justify-content:center;align-items:flex-start;padding:30mm}.cover h1{font-size:30pt;margin:4mm 0}.brand{letter-spacing:.3em;font-weight:800;color:#0e7c86}
.muted{color:#777;font-size:9pt}
</style></head><body>${cover}${html}<script>window.onload=()=>setTimeout(()=>print(),400)</script></body></html>`;
}

function pointIn(p: Vec2, poly: readonly Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

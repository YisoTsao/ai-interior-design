/**
 * 圖紙版面（FE-DOC-06）：把視圖（平面圖 SVG、3D 截圖、圖庫圖片）排進 A4／A3 圖框，
 * 平面圖可指定比例（1:50／1:100／1:200，依 SVG viewBox 的 mm 換算紙上尺寸），附比例尺與圖簽。
 * 產生可列印的 HTML（瀏覽器另存 PDF）。純函式。
 */
export type Paper = 'A4' | 'A3';
export type Orientation = 'landscape' | 'portrait';
export type LayoutTemplate = 'single' | 'two' | 'four';
export interface Viewport {
  kind: 'plan' | 'image';
  /** plan＝SVG 字串；image＝dataURL */
  src: string;
  title: string;
  /** 比例分母（plan 用；0＝符合視窗） */
  scale: number;
}
export interface TitleBlock {
  project: string;
  drawing: string;
  client?: string;
  designer?: string;
  sheet: string;
  date: string;
  /** 圖簽欄位名稱（i18n） */
  labels: {
    project: string;
    drawing: string;
    client: string;
    designer: string;
    scale: string;
    sheet: string;
    date: string;
  };
}

export const PAPER_MM: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297] };
const MARGIN = 10;
const TITLE_H = 28;

export function paperSize(p: Paper, o: Orientation): [number, number] {
  const [a, b] = PAPER_MM[p];
  return o === 'landscape' ? [a, b] : [b, a];
}

/** 版面中的視窗矩形（mm，紙張座標） */
export function viewportRects(
  p: Paper,
  o: Orientation,
  tpl: LayoutTemplate,
): [number, number, number, number][] {
  const [W, H] = paperSize(p, o);
  const x0 = MARGIN;
  const y0 = MARGIN;
  const w = W - 2 * MARGIN;
  const h = H - 2 * MARGIN - TITLE_H;
  const gap = 4;
  if (tpl === 'single') return [[x0, y0, w, h]];
  if (tpl === 'two')
    return o === 'landscape'
      ? [
          [x0, y0, (w - gap) / 2, h],
          [x0 + (w + gap) / 2, y0, (w - gap) / 2, h],
        ]
      : [
          [x0, y0, w, (h - gap) / 2],
          [x0, y0 + (h + gap) / 2, w, (h - gap) / 2],
        ];
  const hw = (w - gap) / 2;
  const hh = (h - gap) / 2;
  return [
    [x0, y0, hw, hh],
    [x0 + hw + gap, y0, hw, hh],
    [x0, y0 + hh + gap, hw, hh],
    [x0 + hw + gap, y0 + hh + gap, hw, hh],
  ];
}

/** 平面 SVG 依比例在紙上的尺寸（mm）；viewBox 單位為 mm */
export function planPaperSize(svg: string, scale: number): [number, number] | null {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m || !scale) return null;
  return [Number(m[1]) / scale, Number(m[2]) / scale];
}

/** 比例尺長度（mm 紙上）：取 1、2、5 × 10ⁿ 的實際長度，使紙上 25–60 mm */
export function scaleBar(scale: number): { realMm: number; paperMm: number } {
  for (const real of [500, 1000, 2000, 5000, 10000, 20000, 50000]) {
    const paper = real / scale;
    if (paper >= 25) return { realMm: real, paperMm: paper };
  }
  return { realMm: 50000, paperMm: 50000 / scale };
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function layoutSheet(o: {
  paper: Paper;
  orientation: Orientation;
  template: LayoutTemplate;
  viewports: Viewport[];
  title: TitleBlock;
  /** 圖簽中的比例欄（多視窗時以第一個平面為準） */
  autoPrint?: boolean;
}): string {
  const [W, H] = paperSize(o.paper, o.orientation);
  const rects = viewportRects(o.paper, o.orientation, o.template);
  const firstPlan = o.viewports.find((v) => v.kind === 'plan' && v.scale);
  const vps = rects
    .map(([x, y, w, h], i) => {
      const v = o.viewports[i];
      if (!v) return `<div class="vp" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm"></div>`;
      let body: string;
      let bar = '';
      if (v.kind === 'plan') {
        const size = planPaperSize(v.src, v.scale);
        const fits = size && size[0] <= w - 4 && size[1] <= h - 10;
        const style = size && fits ? `width:${size[0]}mm;height:${size[1]}mm` : 'width:100%;height:100%';
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(v.src)}`;
        body = `<img src="${url}" style="${style};object-fit:contain" alt="">`;
        if (size && fits) {
          const sb = scaleBar(v.scale);
          bar = `<div class="bar"><svg width="${sb.paperMm + 2}mm" height="6mm" viewBox="0 0 ${sb.paperMm + 2} 6"><rect x="1" y="1" width="${sb.paperMm / 2}" height="1.6" fill="#000"/><rect x="${1 + sb.paperMm / 2}" y="1" width="${sb.paperMm / 2}" height="1.6" fill="#fff" stroke="#000" stroke-width="0.2"/><text x="1" y="5.5" font-size="2.6">0</text><text x="${sb.paperMm - 4}" y="5.5" font-size="2.6">${sb.realMm / 1000} m</text></svg><span>1:${v.scale}</span></div>`;
        } else if (size) bar = `<div class="bar warn">${esc(`1:${v.scale} ✕`)}</div>`;
      } else body = `<img src="${v.src}" style="width:100%;height:100%;object-fit:contain" alt="">`;
      return `<div class="vp" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm"><div class="cap">${esc(v.title)}</div><div class="body">${body}</div>${bar}</div>`;
    })
    .join('');
  const L = o.title.labels;
  const cell = (k: string, v: string, wmm: number) =>
    `<td style="width:${wmm}mm"><small>${esc(k)}</small><b>${esc(v)}</b></td>`;
  const tb = `<table class="tb" style="left:${MARGIN}mm;top:${H - MARGIN - TITLE_H + 2}mm;width:${W - 2 * MARGIN}mm;height:${TITLE_H - 2}mm"><tr>${cell(L.project, o.title.project, 70)}${cell(L.drawing, o.title.drawing, 60)}${cell(L.client, o.title.client ?? '', 40)}${cell(L.designer, o.title.designer ?? '', 40)}${cell(L.scale, firstPlan ? `1:${firstPlan.scale}` : '—', 22)}${cell(L.sheet, o.title.sheet, 18)}${cell(L.date, o.title.date, 30)}</tr></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title.project)} ${esc(o.title.drawing)}</title><style>
@page{size:${o.paper} ${o.orientation};margin:0}
html,body{margin:0;font-family:system-ui,'Noto Sans TC',sans-serif;color:#111}
.sheet{position:relative;width:${W}mm;height:${H}mm;overflow:hidden;background:#fff}
.frame{position:absolute;left:${MARGIN - 3}mm;top:${MARGIN - 3}mm;width:${W - 2 * MARGIN + 6}mm;height:${H - 2 * MARGIN + 6}mm;border:0.6mm solid #111;box-sizing:border-box}
.vp{position:absolute;border:0.25mm solid #888;box-sizing:border-box;display:flex;flex-direction:column}
.vp .cap{font-size:3mm;font-weight:700;padding:1mm 2mm;border-bottom:0.2mm solid #ccc}
.vp .body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.vp .bar{display:flex;align-items:center;gap:2mm;font-size:2.8mm;padding:0 2mm 1mm}
.vp .bar.warn{color:#b33}
.tb{position:absolute;border-collapse:collapse;font-size:3mm}
.tb td{border:0.3mm solid #111;padding:1mm 2mm;vertical-align:top}
.tb small{display:block;color:#666;font-size:2.2mm}
</style></head><body><div class="sheet" data-paper="${o.paper}-${o.orientation}"><div class="frame"></div>${vps}${tb}</div>${o.autoPrint ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

import { describe, expect, it } from 'vitest';
import { layoutSheet, paperSize, planPaperSize, scaleBar, viewportRects } from '../src/export/layout';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-800 -800 10600 10000"></svg>';
const labels = {
  project: '專案',
  drawing: '圖名',
  client: '業主',
  designer: '設計',
  scale: '比例',
  sheet: '圖號',
  date: '日期',
};

describe('圖紙版面（FE-DOC-06）', () => {
  it('紙張與視窗：A3 橫 420×297，四格不重疊', () => {
    expect(paperSize('A3', 'landscape')).toEqual([420, 297]);
    expect(paperSize('A4', 'portrait')).toEqual([210, 297]);
    const r = viewportRects('A3', 'landscape', 'four');
    expect(r).toHaveLength(4);
    expect(r[0]![0] + r[0]![2]).toBeLessThan(r[1]![0]);
    expect(r[0]![1] + r[0]![3]).toBeLessThan(r[2]![1]);
  });
  it('比例換算：10.6 m 寬在 1:100 是 106 mm', () => {
    expect(planPaperSize(svg, 100)).toEqual([106, 100]);
    expect(planPaperSize(svg, 0)).toBeNull();
    expect(scaleBar(100)).toEqual({ realMm: 5000, paperMm: 50 });
    expect(scaleBar(50).paperMm).toBeGreaterThanOrEqual(25);
  });
  it('HTML：@page 尺寸、比例尺、圖簽', () => {
    const html = layoutSheet({
      paper: 'A3',
      orientation: 'landscape',
      template: 'two',
      viewports: [
        { kind: 'plan', src: svg, title: '平面配置圖', scale: 100 },
        { kind: 'image', src: 'data:image/png;base64,AAAA', title: '透視圖', scale: 0 },
      ],
      title: { project: '範例', drawing: '平面與透視', sheet: 'A-01', date: '2026-10-01', labels },
    });
    expect(html).toContain('@page{size:A3 landscape');
    expect(html).toContain('1:100');
    expect(html).toContain('A-01');
    expect(html).toContain('平面配置圖');
  });
  it('放不下時標示（例如 1:50 的 10 m 平面在 A4 單格）', () => {
    const html = layoutSheet({
      paper: 'A4',
      orientation: 'landscape',
      template: 'four',
      viewports: [{ kind: 'plan', src: svg, title: 'x', scale: 50 }],
      title: { project: 'p', drawing: 'd', sheet: '1', date: 'x', labels },
    });
    expect(html).toContain('class="bar warn"');
  });
});

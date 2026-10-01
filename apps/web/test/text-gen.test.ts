import { describe, expect, it } from 'vitest';
import { createCatalog, MaterialSchema, SEED_CATALOG } from '@interiorai/catalog';
import { parseColor, parseSizes, textToFurniture, textToMaterial } from '../src/ai/textGen';

const catalog = createCatalog(SEED_CATALOG);

describe('文字生成（FE-AI-05 規則式）', () => {
  it('顏色與尺寸解析', () => {
    expect(parseColor('深灰色霧面')).toBe('#4b4d50');
    expect(parseColor('#A1B2C3 牆')).toBe('#a1b2c3');
    expect(parseSizes('60x120 公分')).toEqual([600, 1200]);
    expect(parseSizes('600x600 mm')).toEqual([600, 600]);
  });
  it('材質：拋光大理石地板、鼠尾草條紋壁紙、胡桃木地板', () => {
    const m1 = textToMaterial('白色拋光大理石地板 80x80');
    expect(MaterialSchema.safeParse(m1).success).toBe(true);
    expect(m1).toMatchObject({ category: 'floor', roughness: 0.18, realSizeMm: { w: 800, h: 800 } });
    const m2 = textToMaterial('鼠尾草綠條紋壁紙');
    expect(m2).toMatchObject({ pattern: 'wallpaper', motif: 'stripe', color: '#9caf88' });
    expect(MaterialSchema.safeParse(m2).success).toBe(true);
    expect(textToMaterial('胡桃木地板').pattern).toBe('wood');
    expect(textToMaterial('黃銅金屬').metalness).toBe(0.9);
    expect(textToMaterial('a').id).toMatch(/^um_gen_/);
  });
  it('家具：灰色三人沙發寬 200 公分', () => {
    const g = textToFurniture('灰色三人沙發 寬 200 公分', catalog)!;
    expect(g.entry.category).toBe('living');
    expect(g.entry.nameZh).toContain('沙發');
    expect(g.color).toBe('#9a9a96');
    if (g.params.w) expect(g.params.w).toBe(2000);
    expect(textToFurniture('zzz', catalog)).toBeNull();
  });
});

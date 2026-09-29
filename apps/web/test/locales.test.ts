import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import { findCollisions } from '@interiorai/core-geometry';
import { collisionInputs } from '@interiorai/editor-2d';
import en from '../src/locales/en.json';
import zh from '../src/locales/zh-TW.json';
import { buildSampleScene } from '../src/sample';
import { catalog } from '../src/catalogData';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('i18n（02 §8）', () => {
  it('zh-TW 與 en 的鍵完全一致', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort());
  });
  it('程式碼裡用到的 t() 靜態鍵都存在', () => {
    const src = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
          ? src(`${dir}/${d.name}`)
          : d.name.endsWith('.tsx') || d.name.endsWith('.ts')
            ? [readFileSync(`${dir}/${d.name}`, 'utf8')]
            : [],
      );
    const code = [...src('src'), ...src('../../packages/editor-2d/src')].join('\n');
    const used = [...code.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]!);
    const all = new Set(keys(zh));
    expect(used.filter((k) => !all.has(k))).toEqual([]);
  });
});

describe('範例場景', () => {
  const scene = buildSampleScene({ living: '客廳', bed1: '主臥', bed2: '次臥' });
  it('通過 schema 與語意驗證', () => {
    const r = validateScene(scene);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });
  it('3 間房、5 個開口、家具都在目錄中', () => {
    const l = scene.levels[0]!;
    expect(l.rooms).toHaveLength(3);
    expect(l.openings).toHaveLength(5);
    expect(l.objects.every((o) => catalog.get(o.catalogId)?.status === 'published')).toBe(true);
  });
  it('沒有穿牆或家具重疊警示', () => {
    expect(findCollisions(scene.levels[0]!, collisionInputs(scene.levels[0]!, catalog))).toEqual([]);
  });
});

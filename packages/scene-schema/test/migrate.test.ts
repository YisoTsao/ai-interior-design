import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrate, SchemaUnsupportedError, validateScene } from '../src/index.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { jsonSchema, sampleScene } from './helpers.js';

const validateJson = new Ajv2020({ strict: false, allErrors: true }).compile(jsonSchema());

const golden = (name: string) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

describe('migrate', () => {
  it('目前版本：內容不變且不修改輸入', () => {
    const s = { ...sampleScene(), schemaVersion: CURRENT_SCHEMA_VERSION };
    const out = migrate(s);
    expect(out).toEqual(s);
    expect(out).not.toBe(s);
  });
  it('1.0.0 → 目前版本：新欄位皆選填，只升版號', () => {
    const s = sampleScene();
    expect(s.schemaVersion).toBe('1.0.0');
    expect(migrate(s)).toEqual({ ...s, schemaVersion: CURRENT_SCHEMA_VERSION });
  });
  it('1.2.0 門窗樣式、鋪貼、房間用途、群組通過驗證', () => {
    const s = structuredClone({ ...sampleScene(), schemaVersion: '1.2.0' });
    s.levels[0]!.rooms[0]!.floorTiling = { pattern: 'herringbone', tileW: 600, tileH: 120, grout: 2 };
    s.levels[0]!.rooms[0]!.kind = 'living';
    s.levels[0]!.objects[0]!.groupId = 'grp_1';
    if (s.levels[0]!.openings[0]) s.levels[0]!.openings[0]!.style = 'sliding';
    expect(validateScene(s).ok).toBe(true);
    s.levels[0]!.rooms[0]!.floorTiling = { pattern: 'herringbone', tileW: 5, tileH: 120 };
    expect(validateScene(s).ok).toBe(false);
  });
  it('1.3.0 貼圖參數、護牆板、頂角線、天花造型通過驗證，超出範圍被拒', () => {
    const s = structuredClone({ ...sampleScene(), schemaVersion: CURRENT_SCHEMA_VERSION });
    const w = s.levels[0]!.walls[0]!;
    w.wainscot = { height: 900, style: 'panel', sides: 'both', color: '#e8e2d6' };
    w.crown = { height: 80, profile: 'cove' };
    w.baseboardProfile = 'step';
    w.appearance = { uvScale: 2, uvRotation: 45, uvOffset: [100, 0] };
    s.levels[0]!.rooms[0]!.ceiling = { type: 'cove', dropMm: 150, borderMm: 600, coveKelvin: 2700 };
    expect(validateScene(s).ok).toBe(true);
    s.levels[0]!.rooms[0]!.ceiling = { type: 'tray', dropMm: 5, borderMm: 600 };
    expect(validateScene(s).ok).toBe(false);
  });
  it('1.4.0 標註 angle／arrow／tag、弧牆 arcGroup、燈光群組與情境通過驗證，超出範圍被拒', () => {
    const s = structuredClone({ ...sampleScene(), schemaVersion: CURRENT_SCHEMA_VERSION });
    const lv = s.levels[0]!;
    lv.annotations = [
      { id: 'ann_1', type: 'angle', data: { center: [0, 0], a: [1000, 0], b: [0, 1000] } },
      { id: 'ann_2', type: 'arrow', data: { a: [0, 0], b: [500, 500] } },
      { id: 'ann_3', type: 'tag', data: { position: [100, 100], number: 1, text: '電視櫃' } },
    ];
    lv.walls[0]!.arcGroup = 'arc_1';
    lv.objects[0]!.light = { group: '客廳主燈' };
    s.lightScenes = [{ id: 'ls_1', name: '晚餐', states: { [lv.objects[0]!.id]: { on: true, level: 0.4 } } }];
    expect(validateScene(s).ok).toBe(true);
    const j = validateJson(s);
    expect(j).toBe(true);
    s.lightScenes = [{ id: 'ls_1', name: '晚餐', states: { [lv.objects[0]!.id]: { on: true, level: 2 } } }];
    expect(validateScene(s).ok).toBe(false);
    expect(validateJson(s)).toBe(false);
  });
  it('1.1.0 外觀／光源／環境欄位通過驗證，超出範圍被拒', () => {
    const s = structuredClone({ ...sampleScene(), schemaVersion: CURRENT_SCHEMA_VERSION });
    s.environment = { sky: 'city', exposureEv: 0.5 };
    s.levels[0]!.walls[0]!.height = 1200;
    s.levels[0]!.walls[0]!.appearance = { color: '#aabbcc', roughness: 0.4 };
    s.levels[0]!.objects[0]!.light = { lumens: 800, kelvin: 2700, tiltDeg: -30 };
    expect(validateScene(s).ok).toBe(true);
    s.levels[0]!.objects[0]!.light = { kelvin: 500 };
    expect(validateScene(s).ok).toBe(false);
  });
  it('v0（無 schemaVersion）→ 目前版本，並通過驗證（Golden File）', () => {
    const v0 = JSON.parse(readFileSync(golden('v0-input.json'), 'utf8'));
    const out = migrate(v0);
    const expectedPath = golden(`v0-expected-${CURRENT_SCHEMA_VERSION}.json`);
    if (!existsSync(expectedPath)) writeFileSync(expectedPath, JSON.stringify(out, null, 2) + '\n');
    expect(out).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')));
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(validateScene(out).ok).toBe(true);
  });
  it('較新或未知版本 → SCHEMA_UNSUPPORTED', () => {
    for (const v of ['2.0.0', '1.9.0', 'abc']) {
      expect(() => migrate({ ...sampleScene(), schemaVersion: v })).toThrow(SchemaUnsupportedError);
    }
    expect(() => migrate(null)).toThrow(SchemaUnsupportedError);
    expect(() => migrate([])).toThrow(SchemaUnsupportedError);
  });
  it('缺 migration 鏈 → SCHEMA_UNSUPPORTED', () => {
    expect(() => migrate({ levels: [] }, [])).toThrow(/0\.0\.0/);
  });
  it('序列化往返穩定（Golden：sample 讀→驗→寫）', () => {
    const s = sampleScene();
    const r = validateScene(JSON.parse(JSON.stringify(s)));
    expect(r.ok && JSON.stringify(r.scene)).toBe(JSON.stringify(s));
  });
});

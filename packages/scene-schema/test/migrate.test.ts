import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrate, SchemaUnsupportedError, validateScene } from '../src/index.js';
import { sampleScene } from './helpers.js';

const golden = (name: string) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

describe('migrate', () => {
  it('目前版本：內容不變且不修改輸入', () => {
    const s = sampleScene();
    const out = migrate(s);
    expect(out).toEqual(s);
    expect(out).not.toBe(s);
  });
  it('v0（無 schemaVersion）→ 1.0.0，並通過驗證（Golden File）', () => {
    const v0 = JSON.parse(readFileSync(golden('v0-input.json'), 'utf8'));
    const out = migrate(v0);
    const expectedPath = golden('v0-expected-1.0.0.json');
    if (!existsSync(expectedPath)) writeFileSync(expectedPath, JSON.stringify(out, null, 2) + '\n');
    expect(out).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')));
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(validateScene(out).ok).toBe(true);
  });
  it('較新或未知版本 → SCHEMA_UNSUPPORTED', () => {
    for (const v of ['2.0.0', '1.1.0', 'abc']) {
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

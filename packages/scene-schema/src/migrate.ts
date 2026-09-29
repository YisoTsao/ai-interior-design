import { CURRENT_SCHEMA_VERSION } from './schema.js';

export class SchemaUnsupportedError extends Error {
  readonly code = 'SCHEMA_UNSUPPORTED';
  constructor(readonly version: string) {
    super(`不支援的 schemaVersion：${version}（目前 ${CURRENT_SCHEMA_VERSION}）`);
  }
}

type Json = Record<string, unknown>;
/** 從某版本升到下一版本的純函式。新增版本時在這裡註冊並補 Golden File 測試。 */
export type Migration = { from: string; to: string; up: (s: Json) => Json };

export const MIGRATIONS: Migration[] = [
  // v0 草稿格式（無 schemaVersion、units 欄位）→ 1.0.0
  {
    from: '0.0.0',
    to: '1.0.0',
    up: (s) => ({ ...s, schemaVersion: '1.0.0', units: 'mm' }),
  },
];

const parse = (v: string) => v.split('.').map((n) => Number(n)) as [number, number, number];
const cmp = (a: string, b: string) => {
  const [a0, a1, a2] = parse(a);
  const [b0, b1, b2] = parse(b);
  return a0 - b0 || a1 - b1 || a2 - b2;
};

/**
 * 把任意舊版 scene 升級到目前版本；不修改輸入。
 * 規則：比目前版本新（含未知 major）→ SchemaUnsupportedError；同 major 較新的 minor/patch 也拒絕（避免遺失欄位）。
 */
export function migrate(input: unknown, migrations: Migration[] = MIGRATIONS): Json {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new SchemaUnsupportedError('invalid');
  let scene = JSON.parse(JSON.stringify(input)) as Json; // scene 為 JSON 資料；不依賴 DOM/Node 的 structuredClone
  let version = typeof scene.schemaVersion === 'string' ? scene.schemaVersion : '0.0.0';
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new SchemaUnsupportedError(version);
  if (cmp(version, CURRENT_SCHEMA_VERSION) > 0) throw new SchemaUnsupportedError(version);
  while (version !== CURRENT_SCHEMA_VERSION) {
    const m = migrations.find((x) => x.from === version);
    if (!m) throw new SchemaUnsupportedError(version);
    scene = m.up(scene);
    version = m.to;
  }
  return scene;
}

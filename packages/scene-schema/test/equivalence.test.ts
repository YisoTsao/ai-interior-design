import Ajv2020 from 'ajv/dist/2020.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS, SceneSchema } from '../src/index.js';
import { jsonSchema, sampleScene } from './helpers.js';

// Zod 與 scene.schema.json 必須「接受/拒絕」一致（S1.1）。
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateJson = ajv.compile(jsonSchema());
const agree = (v: unknown) => {
  const j = validateJson(v) === true;
  const z = SceneSchema.safeParse(v).success;
  return { j, z };
};

type Json = Record<string, unknown>;
const set = (obj: Json, path: (string | number)[], value: unknown): Json => {
  const clone = structuredClone(obj);
  let cur: Json = clone;
  for (const k of path.slice(0, -1)) cur = cur[k as string] as Json;
  const last = path[path.length - 1]!;
  if (value === undefined) delete cur[last as string];
  else cur[last as string] = value;
  return clone;
};

const paths: (string | number)[][] = [
  ['schemaVersion'],
  ['units'],
  ['levels'],
  ['cameras'],
  ['meta'],
  ['levels', 0, 'id'],
  ['levels', 0, 'height'],
  ['levels', 0, 'elevation'],
  ['levels', 0, 'walls'],
  ['levels', 0, 'walls', 0, 'a'],
  ['levels', 0, 'walls', 0, 'a', 0],
  ['levels', 0, 'walls', 0, 'thickness'],
  ['levels', 0, 'walls', 0, 'type'],
  ['levels', 0, 'walls', 0, 'confidence'],
  ['levels', 0, 'openings', 0, 'offset'],
  ['levels', 0, 'openings', 0, 'width'],
  ['levels', 0, 'openings', 0, 'type'],
  ['levels', 0, 'openings', 0, 'swing'],
  ['levels', 0, 'rooms', 0, 'wallIds'],
  ['levels', 0, 'objects', 0, 'position'],
  ['levels', 0, 'objects', 0, 'scale'],
  ['levels', 0, 'objects', 0, 'rotationY'],
  ['levels', 0, 'objects', 0, 'catalogId'],
  ['cameras', 0, 'fovDeg'],
  ['meta', 'source'],
  ['levels', 0, 'extraField'],
  ['extraTop'],
];
const values = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.string({ maxLength: 70 }),
  fc.constantFrom('w_01', 'x', 'bad id', '1.2.3', '2.0.0', 'mm', 'm', 'door', 'exterior', 'left', 'manual'),
  fc.integer({ min: -2_000_000, max: 2_000_000 }),
  fc.double({ noNaN: true, min: -10, max: 10 }),
  fc.constantFrom(
    0,
    20,
    19,
    200,
    199,
    600,
    601,
    1800,
    6000,
    6001,
    10,
    120,
    121,
    LIMITS.coord,
    LIMITS.coord + 1,
  ),
  fc.array(fc.integer({ min: -5, max: 5 }), { maxLength: 4 }),
  fc.constant([]),
  fc.constant({}),
);

describe('Zod ↔ JSON Schema 等價', () => {
  it('sample scene：兩者皆接受', () => {
    expect(agree(sampleScene())).toEqual({ j: true, z: true });
  });

  it('property：隨機變異後兩者判定一致', () => {
    fc.assert(
      fc.property(fc.constantFrom(...paths), values, (path, value) => {
        const mutated = set(sampleScene() as unknown as Json, path, value);
        const r = agree(mutated);
        expect(r.z, `path=${path.join('/')} value=${JSON.stringify(value)}`).toBe(r.j);
      }),
      { numRuns: 1500 },
    );
  });

  it('上限（maxItems）一致', () => {
    const s = sampleScene() as unknown as Json;
    const wall = (i: number) => ({ id: `w_x${i}`, a: [0, i], b: [1000, i], thickness: 100 });
    const many = set(
      s,
      ['levels', 0, 'walls'],
      Array.from({ length: LIMITS.wallsPerLevel + 1 }, (_, i) => wall(i)),
    );
    expect(agree(many)).toEqual({ j: false, z: false });
  });

  it('JSON Schema 的上限數值與 LIMITS 相同', () => {
    const js = jsonSchema() as { $defs: Record<string, Record<string, unknown>> };
    const lv = js.$defs.level!.properties as Record<string, { maxItems?: number }>;
    expect(lv.walls!.maxItems).toBe(LIMITS.wallsPerLevel);
    expect(lv.openings!.maxItems).toBe(LIMITS.openingsPerLevel);
    expect(lv.objects!.maxItems).toBe(LIMITS.objectsPerLevel);
    expect(lv.rooms!.maxItems).toBe(LIMITS.roomsPerLevel);
    expect((js.$defs.mm as { maximum: number }).maximum).toBe(LIMITS.coord);
  });
});

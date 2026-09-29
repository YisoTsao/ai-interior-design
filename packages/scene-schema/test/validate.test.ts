import { describe, expect, it } from 'vitest';
import { newId, validateScene, type Scene } from '../src/index.js';
import { sampleScene } from './helpers.js';

const codes = (s: unknown) => {
  const r = validateScene(s);
  return r.ok ? [] : r.issues.map((i) => i.code);
};
const withLevel = (f: (l: Scene['levels'][number]) => void) => {
  const s = sampleScene();
  f(s.levels[0]!);
  return s;
};

describe('validateScene', () => {
  it('sample 通過', () => {
    const r = validateScene(sampleScene());
    expect(r.ok).toBe(true);
  });
  it('結構錯誤回 SCHEMA 並附路徑，且不跑語意', () => {
    const r = validateScene({ ...sampleScene(), units: 'm' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: 'SCHEMA', path: '/units' });
  });
  it('重複 id', () => {
    expect(codes(withLevel((l) => (l.openings[0]!.id = l.walls[0]!.id)))).toContain('DUPLICATE_ID');
  });
  it('過短牆與厚度≥長度', () => {
    expect(codes(withLevel((l) => (l.walls[0]!.b = [50, 0])))).toContain('WALL_TOO_SHORT');
    expect(codes(withLevel((l) => (l.walls[0]!.b = [150, 0])))).toContain('WALL_THICKER_THAN_LENGTH');
  });
  it('開口：懸空參照、超出牆、過高、重疊', () => {
    expect(codes(withLevel((l) => (l.openings[0]!.wallId = 'w_missing')))).toContain('DANGLING_REF');
    expect(codes(withLevel((l) => (l.openings[0]!.offset = 4500)))).toContain('OPENING_OUT_OF_WALL');
    expect(codes(withLevel((l) => (l.openings[1]!.sill = 2000)))).toContain('OPENING_TOO_TALL');
    expect(
      codes(
        withLevel((l) =>
          l.openings.push({
            id: 'o_x',
            wallId: 'w_01',
            type: 'window',
            offset: 1000,
            width: 500,
            height: 500,
          }),
        ),
      ),
    ).toContain('OPENING_OVERLAP');
  });
  it('相鄰但不重疊的開口可接受', () => {
    expect(
      codes(
        withLevel((l) =>
          l.openings.push({
            id: 'o_x',
            wallId: 'w_01',
            type: 'window',
            offset: 1700,
            width: 500,
            height: 500,
          }),
        ),
      ),
    ).toEqual([]);
  });
  it('房間：重複牆、懸空牆；物件懸空房間', () => {
    expect(codes(withLevel((l) => (l.rooms[0]!.wallIds = ['w_01', 'w_01', 'w_02'])))).toContain(
      'ROOM_DUPLICATE_WALL',
    );
    expect(codes(withLevel((l) => (l.rooms[0]!.wallIds = ['w_01', 'w_02', 'w_zz'])))).toContain(
      'DANGLING_REF',
    );
    expect(codes(withLevel((l) => (l.objects[0]!.roomId = 'r_zz')))).toContain('DANGLING_REF');
    expect(codes(withLevel((l) => (l.objects[0]!.roomId = 'r_01')))).toEqual([]);
  });
  it('相機 id 重複', () => {
    const s = sampleScene();
    s.cameras = [s.cameras![0]!, s.cameras![0]!];
    expect(codes(s)).toContain('DUPLICATE_ID');
  });
  it('無 cameras 欄位也可', () => {
    const s = sampleScene();
    delete s.cameras;
    expect(codes(s)).toEqual([]);
  });
  it('newId 產生符合格式的前綴 ULID', () => {
    const id = newId('w');
    expect(id).toMatch(/^w_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newId('w')).not.toBe(id);
  });
});

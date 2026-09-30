import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, sourcesOf, type JobState } from '../../src/modules/jobs/job-state.js';
import { checkDeclared, safeFilename, sniff } from '../../src/modules/uploads/upload-policy.js';
import { stableStringify } from '../../src/common/idempotency.interceptor.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { signAccess, verifyAccess } from '../../src/modules/auth/tokens.js';

describe('Job 狀態機', () => {
  const all: JobState[] = ['queued', 'running', 'validating', 'succeeded', 'failed', 'canceled'];
  it('終態不能再轉換', () => {
    for (const t of all.filter(isTerminal)) for (const to of all) expect(canTransition(t, to)).toBe(false);
  });
  it('驗證重試＝validating → running；failed 不會復活', () => {
    expect(canTransition('validating', 'running')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(false);
    expect(canTransition('queued', 'succeeded')).toBe(false);
  });
  it('sourcesOf 與 canTransition 一致', () => {
    for (const to of all)
      for (const from of all) expect(sourcesOf(to).includes(from)).toBe(canTransition(from, to));
  });
});

describe('上傳白名單', () => {
  it('DWG 一律拒絕（副檔名或 mime）', () => {
    expect(checkDeclared('plan', 'a.dwg', 'application/octet-stream', 10).ok).toBe(false);
    expect(checkDeclared('plan', 'a.bin', 'image/vnd.dwg', 10).ok).toBe(false);
  });
  it('依用途限制型別與大小', () => {
    expect(checkDeclared('plan', 'p.dxf', 'image/vnd.dxf', 1000)).toEqual({ ok: true, type: 'dxf' });
    expect(checkDeclared('gbuffer', 'd.jpg', 'image/jpeg', 1000).ok).toBe(false);
    expect(checkDeclared('photo', 'p.png', 'image/png', 21 * 1024 * 1024).ok).toBe(false);
    expect(checkDeclared('photo', 'p.svg', 'image/svg+xml', 10).ok).toBe(false);
  });
  it('檔頭判斷', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(Buffer.from('%PDF-1.7'))).toBe('pdf');
    expect(sniff(Buffer.from('  0\nSECTION\n  2\nHEADER'))).toBe('dxf');
    expect(sniff(Buffer.from('glTF\x02\x00'))).toBe('glb');
    expect(sniff(Buffer.from('<svg'))).toBeNull();
  });
  it('檔名清理：不可逃出目錄', () => {
    expect(safeFilename('../../etc/passwd')).not.toContain('/');
    expect(safeFilename('平面圖 v2.png')).toBe('平面圖_v2.png');
    expect(safeFilename('...')).toBe('file');
  });
});

describe('stableStringify', () => {
  it('與鍵順序無關', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
    expect(stableStringify({ a: [1, 2] })).not.toBe(stableStringify({ a: [2, 1] }));
  });
});

describe('密碼與 token', () => {
  it('scrypt 雜湊可驗證、錯誤密碼失敗、帳號不存在也回 false', async () => {
    const h = await hashPassword('correct horse');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
  it('JWT：簽章錯誤或過期都無效', async () => {
    const t = await signAccess({ sub: 'u1', org: 'o1', role: 'owner' }, 'secret-a', 60);
    expect(await verifyAccess(t, 'secret-a')).toEqual({ sub: 'u1', org: 'o1', role: 'owner' });
    expect(await verifyAccess(t, 'secret-b')).toBeNull();
    const expired = await signAccess({ sub: 'u1', org: 'o1', role: 'owner' }, 'secret-a', -10);
    expect(await verifyAccess(expired, 'secret-a')).toBeNull();
  });
});

import { migrate, validateScene, type Scene } from '@interiorai/scene-schema';

/**
 * 分享連結（FE-SHR-01）：場景 JSON → deflate-raw → base64url，放在 URL hash（不經伺服器、不需登入）。
 * 之後改用 Supabase 時，可改為上傳快照取得短網址；檢視頁同時支援兩種來源。
 */
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** 分享中的替代方案（FE-SHR-06：客戶在分享頁勾選方案） */
export interface SharedScheme {
  name: string;
  scene: Scene;
}
export interface SharePayload {
  name: string;
  scene: Scene;
  /** 替代方案（第一個方案＝scene 本身，不重複放） */
  schemes: SharedScheme[];
  /** 要求客戶簽名確認 */
  approval: boolean;
}

export async function encodeShare(
  scene: Scene,
  name: string,
  opts: { schemes?: SharedScheme[]; approval?: boolean } = {},
): Promise<string> {
  const json = new TextEncoder().encode(
    JSON.stringify({ v: 2, name, scene, schemes: opts.schemes ?? [], approval: !!opts.approval }),
  );
  return b64url(await pipe(json, new CompressionStream('deflate-raw')));
}
const check = (raw: unknown): Scene => {
  const v = validateScene(migrate(raw));
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join('; '));
  return v.scene;
};
export async function decodeShare(data: string): Promise<SharePayload> {
  const raw = await pipe(unb64url(data), new DecompressionStream('deflate-raw'));
  const obj = JSON.parse(new TextDecoder().decode(raw)) as {
    name?: string;
    scene: unknown;
    schemes?: { name?: string; scene: unknown }[];
    approval?: boolean;
  };
  return {
    name: obj.name ?? '',
    scene: check(obj.scene),
    schemes: (obj.schemes ?? []).map((x, i) => ({ name: x.name || `#${i + 2}`, scene: check(x.scene) })),
    approval: !!obj.approval,
  };
}
export async function shareUrl(
  scene: Scene,
  name: string,
  opts: { schemes?: SharedScheme[]; approval?: boolean } = {},
): Promise<string> {
  window.dispatchEvent(new CustomEvent('interiorai:achievement', { detail: 'share' }));
  return `${window.location.origin}/view#s=${await encodeShare(scene, name, opts)}`;
}

// ── 客戶確認碼（FE-SHR-06）────────────────────────────────────────

/** 場景指紋：只取設計內容（levels、environment、lightScenes），不含 meta（確認紀錄本身） */
export async function sceneHash(scene: Scene): Promise<string> {
  const body = JSON.stringify({
    l: scene.levels,
    e: scene.environment ?? null,
    s: scene.lightScenes ?? null,
  });
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export interface ApprovalCode {
  project: string;
  scheme: string;
  schemeHash: string;
  client: string;
  note?: string;
  signedAt: string;
  signature: string;
}
const PREFIX = 'IAI-OK-';
export async function encodeApproval(a: ApprovalCode): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, ...a }));
  return PREFIX + b64url(await pipe(json, new CompressionStream('deflate-raw')));
}
export async function decodeApproval(code: string): Promise<ApprovalCode> {
  const c = code.trim();
  if (!c.startsWith(PREFIX)) throw new Error('NOT_APPROVAL');
  const raw = await pipe(unb64url(c.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
  const o = JSON.parse(new TextDecoder().decode(raw)) as Partial<ApprovalCode>;
  if (!o.schemeHash || !o.client || !o.signedAt || !o.signature?.startsWith('data:image/png'))
    throw new Error('NOT_APPROVAL');
  return o as ApprovalCode;
}

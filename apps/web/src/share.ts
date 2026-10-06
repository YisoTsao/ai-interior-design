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

export async function encodeShare(scene: Scene, name: string): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, name, scene }));
  return b64url(await pipe(json, new CompressionStream('deflate-raw')));
}
export async function decodeShare(data: string): Promise<{ name: string; scene: Scene }> {
  const raw = await pipe(unb64url(data), new DecompressionStream('deflate-raw'));
  const obj = JSON.parse(new TextDecoder().decode(raw)) as { name?: string; scene: unknown };
  const v = validateScene(migrate(obj.scene));
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join('; '));
  return { name: obj.name ?? '', scene: v.scene };
}
export async function shareUrl(scene: Scene, name: string): Promise<string> {
  return `${window.location.origin}/view#s=${await encodeShare(scene, name)}`;
}

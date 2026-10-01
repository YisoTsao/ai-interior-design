/**
 * 漫遊影片（FE-RND-06）：以相機書籤為關鍵幀，依序以緩動插值（位置、注視點、視角），
 * 預覽與錄影共用同一條路徑。純函式，便於測試。
 */
export interface CamKey {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: readonly number[], b: readonly number[], t: number) =>
  [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)] as [number, number, number];

/** 總時長（秒）：每段 segSec，至少兩個關鍵幀 */
export const pathDuration = (keys: readonly CamKey[], segSec: number) =>
  Math.max(0, keys.length - 1) * Math.max(0.5, segSec);

/** t 秒時的相機；超出範圍夾到首尾 */
export function cameraAt(keys: readonly CamKey[], segSec: number, t: number): CamKey | null {
  if (!keys.length) return null;
  if (keys.length === 1) return keys[0]!;
  const seg = Math.max(0.5, segSec);
  const total = pathDuration(keys, seg);
  const c = Math.min(total, Math.max(0, t));
  const i = Math.min(keys.length - 2, Math.floor(c / seg));
  const u = ease((c - i * seg) / seg);
  const a = keys[i]!;
  const b = keys[i + 1]!;
  return {
    position: lerp3(a.position, b.position, u),
    target: lerp3(a.target, b.target, u),
    fovDeg: lerp(a.fovDeg, b.fovDeg, u),
  };
}

/** 瀏覽器支援的錄影格式（MP4 優先） */
export function pickVideoType(
  isSupported: (t: string) => boolean,
): { mime: string; ext: 'mp4' | 'webm' } | null {
  for (const mime of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'])
    if (isSupported(mime)) return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return null;
}

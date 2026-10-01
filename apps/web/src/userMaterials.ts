import { createStore, get, set } from 'idb-keyval';
import { MaterialSchema, type Material } from '@interiorai/catalog';
import { setUserMaterials } from './catalogData';

/**
 * 自訂材質（FE-FIN-06）：上傳貼圖（底色）＋真實尺寸、粗糙度、金屬度 → 存在本機 IndexedDB，
 * 啟動時加入材質庫；id 前綴 um_。貼圖縮到 1024 px 以內以控制容量。
 */
const store = createStore('interiorai-materials', 'user');
const KEY = 'list';

export async function initUserMaterials() {
  try {
    const raw = (await get<unknown[]>(KEY, store)) ?? [];
    setUserMaterials(
      raw.flatMap((r) => {
        const v = MaterialSchema.safeParse(r);
        return v.success ? [v.data] : [];
      }),
    );
  } catch {
    /* 無法使用 IndexedDB */
  }
}
export const listUserMaterials = async () => (await get<Material[]>(KEY, store)) ?? [];

async function toDataUrl(
  file: File,
  type: 'image/jpeg' | 'image/png' = 'image/jpeg',
  max = 1024,
): Promise<{ url: string; color: string }> {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  // 平均色（縮圖、2D 顯示與鋪貼用）
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 16) {
    r += px[i]!;
    gg += px[i + 1]!;
    b += px[i + 2]!;
  }
  const m = n / 4;
  const hex = (v: number) =>
    Math.round(v / m)
      .toString(16)
      .padStart(2, '0');
  return { url: c.toDataURL(type, 0.88), color: `#${hex(r)}${hex(gg)}${hex(b)}` };
}

export async function saveUserMaterial(o: {
  file: File;
  name: string;
  category: Material['category'];
  realSizeMm: { w: number; h: number };
  roughness: number;
  metalness: number;
  pricePerM2Twd?: number;
  /** 法線／粗糙度貼圖（FE-FIN-06，選填） */
  normalFile?: File | null;
  roughnessFile?: File | null;
}): Promise<Material> {
  const { url, color } = await toDataUrl(o.file);
  const normalUrl = o.normalFile ? (await toDataUrl(o.normalFile, 'image/png')).url : undefined;
  const roughnessUrl = o.roughnessFile ? (await toDataUrl(o.roughnessFile, 'image/png')).url : undefined;
  const m = MaterialSchema.parse({
    id: `um_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    nameZh: o.name,
    nameEn: o.name,
    category: o.category,
    color,
    pattern: 'image',
    textureUrl: url,
    ...(normalUrl ? { normalUrl } : {}),
    ...(roughnessUrl ? { roughnessUrl } : {}),
    realSizeMm: { w: Math.max(1, Math.round(o.realSizeMm.w)), h: Math.max(1, Math.round(o.realSizeMm.h)) },
    roughness: o.roughness,
    metalness: o.metalness,
    ...(o.pricePerM2Twd ? { pricePerM2Twd: Math.round(o.pricePerM2Twd) } : {}),
    license: { type: 'user-provided', source: '使用者上傳', allowedUse: ['render'] },
  });
  const list = [...(await listUserMaterials()), m];
  await set(KEY, list, store);
  setUserMaterials(list);
  return m;
}

export async function deleteUserMaterial(id: string) {
  const list = (await listUserMaterials()).filter((m) => m.id !== id);
  await set(KEY, list, store);
  setUserMaterials(list);
}

/** 直接存一筆材質（文字生成材質 FE-AI-05；id 需以 um_ 開頭） */
export async function saveMaterialRecord(m: Material): Promise<Material> {
  const v = MaterialSchema.parse(m);
  const list = [...(await listUserMaterials()).filter((x) => x.id !== v.id), v];
  await set(KEY, list, store);
  setUserMaterials(list);
  return v;
}

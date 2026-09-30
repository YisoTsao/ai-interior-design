import { createStore, del, get, set } from 'idb-keyval';

/**
 * 本機媒體庫（IndexedDB）：專案縮圖（FE-PRJ-01）、視角書籤縮圖（FE-V3D-09）、渲染／截圖／全景圖庫（FE-RND-04）。
 * 雲端同步之後經由 BlobStore 介面接上。
 */
const store = createStore('interiorai-media', 'items');

export interface GalleryItem {
  id: string;
  kind: 'screenshot' | 'panorama' | 'render' | 'plan';
  name: string;
  createdAt: string;
  blob: Blob;
  width?: number;
  height?: number;
}

export const dataUrlToBlob = async (url: string) => (await fetch(url)).blob();

export async function setProjectThumb(projectId: string, dataUrl: string) {
  await set(`thumb:${projectId}`, dataUrl, store);
}
export const getProjectThumb = (projectId: string) => get<string>(`thumb:${projectId}`, store);
export const deleteProjectMedia = async (projectId: string) => {
  await del(`thumb:${projectId}`, store);
  await del(`gallery:${projectId}`, store);
};

export const setCameraThumb = (camId: string, dataUrl: string) => set(`cam:${camId}`, dataUrl, store);
export const getCameraThumb = (camId: string) => get<string>(`cam:${camId}`, store);

export async function listGallery(projectId: string): Promise<GalleryItem[]> {
  return (await get<GalleryItem[]>(`gallery:${projectId}`, store)) ?? [];
}
export async function addToGallery(projectId: string, item: Omit<GalleryItem, 'id' | 'createdAt'>) {
  const list = await listGallery(projectId);
  const it: GalleryItem = {
    ...item,
    id: `g_${crypto.randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
  };
  await set(`gallery:${projectId}`, [it, ...list].slice(0, 200), store);
  return it;
}
export async function removeFromGallery(projectId: string, id: string) {
  const list = await listGallery(projectId);
  await set(
    `gallery:${projectId}`,
    list.filter((x) => x.id !== id),
    store,
  );
}

/** 縮小 dataURL（縮圖用） */
export async function shrink(dataUrl: string, maxSide = 480): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export function download(blobOrUrl: Blob | string, filename: string) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 2000);
}

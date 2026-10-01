/**
 * 開啟「上傳 3D 模型」對話框的請求（資產庫按鈕、指令面板、拖放模型檔到編輯器）。
 * 對話框掛在 Editor 層，左側面板切換分頁時不會被卸載。
 */
export const UPLOAD_MODEL_EVENT = 'interiorai:upload-model';

export const requestModelUpload = (files?: File[]) =>
  window.dispatchEvent(new CustomEvent<File[] | null>(UPLOAD_MODEL_EVENT, { detail: files ?? null }));

/** 拖放的檔案中是否有 3D 模型（含 zip、SketchUp 以顯示轉檔說明） */
export const hasModelFile = (files: readonly File[]) =>
  files.some((f) => /\.(glb|gltf|obj|fbx|dae|stl|ply|3ds|3mf|usdz|wrl|zip|skp)$/i.test(f.name));

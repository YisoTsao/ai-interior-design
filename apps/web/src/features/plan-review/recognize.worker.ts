/// <reference lib="webworker" />
import { PlanParseError, recognizeRaster, rgbaToGray } from '@interiorai/plan-recognition';

/** 點陣辨識在 Worker 執行（大圖需數百毫秒到數秒，不阻塞畫面） */
self.onmessage = (e: MessageEvent<{ rgba: ArrayBuffer; width: number; height: number }>) => {
  const { rgba, width, height } = e.data;
  try {
    const result = recognizeRaster(rgbaToGray(new Uint8ClampedArray(rgba), width, height));
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({
      ok: false,
      code: err instanceof PlanParseError ? err.code : 'PARSE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

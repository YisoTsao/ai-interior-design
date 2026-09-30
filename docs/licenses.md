# 授權登記表（docs/licenses.md）
規則：任何進入產品或訓練流程的「資料集/模型/素材/字型/套件/API」都必須在此登記。標「非商用」者不得進入商用版本。

| 類別 | 名稱 | 版本/來源 | 授權 | 可商用 | 可再散布 | 用於 | 備註/待辦 | 核對日 |
|---|---|---|---|---|---|---|---|---|
| 資料集 | CubiCasa5K | github.com/CubiCasa/CubiCasa5k | CC BY-NC（第三方專案標註；請核對原始授權） | ❌（需商用授權） | — | 研究/預訓練評估 | 商用前取得授權或移除 | |
| 資料集 | ResPlan | HF Papers | 待核對 | 待核對 | | | | |
| 模型 | 影像生成供應商條款 | OpenAI / BFL / Google | 服務條款 | 依條款 | — | AI 渲染 | 核對資料保留與訓練條款 | |
| 套件 | three, @react-three/fiber, drei | npm | MIT | ✅ | ✅ | 3D | | |
| 套件 | three-bvh-csg | npm | MIT | ✅ | ✅ | 開口 | | |
| 套件 | Clipper2 (WASM/JS 版) | npm | Boost | ✅ | ✅ | 幾何 | 選定實際套件後核對 | |
| 套件 | ezdxf | PyPI | MIT | ✅ | ✅ | DXF | | |
| 轉檔 | ODA / LibreDWG (DWG) | — | 商業 / GPL | ⚠️ | ⚠️ | DWG→DXF | GPL 傳染性與商業授權需法務確認 | |
| 字型 | Noto Sans TC | Google Fonts | OFL | ✅ | ✅ | UI | | |
| 素材 | （每件 3D 模型/貼圖逐筆登記） | | | | | 資產庫 | | |
| 套件 | react / react-dom | npm 19.x | MIT | ✅ | ✅ | UI |  | 2026-09-29 |
| 套件 | three | npm 0.18x | MIT | ✅ | ✅ | 3D |  | 2026-09-29 |
| 套件 | @react-three/fiber、@react-three/drei | npm | MIT | ✅ | ✅ | 3D |  | 2026-09-29 |
| 套件 | three-bvh-csg、three-mesh-bvh | npm | MIT | ✅ | ✅ | 開口 CSG |  | 2026-09-29 |
| 套件 | clipper2-ts（候選）／clipper2-wasm | npm | BSL-1.0（Boost） | ✅ | ✅ | 牆輪廓 | P1 選定後以實際採用者為準 | 2026-09-29 |
| 套件 | zustand、immer、zod | npm | MIT | ✅ | ✅ | 狀態/驗證 |  | 2026-09-29 |
| 套件 | konva、react-konva／pixi.js | npm | MIT | ✅ | ✅ | 2D（ADR-010 二選一） |  | 2026-09-29 |
| 套件 | @tanstack/react-query、@radix-ui/*、tailwindcss、i18next | npm | MIT | ✅ | ✅ | 前端 |  | 2026-09-29 |
| 套件 | idb-keyval | npm | Apache-2.0 | ✅ | ✅ | autosave |  | 2026-09-29 |
| 套件 | typescript、playwright、fake-indexeddb | npm | Apache-2.0 | ✅ | ✅ | 開發/測試 | 僅開發依賴 | 2026-09-29 |
| 套件 | vite、vitest、eslint、turbo、fast-check | npm | MIT | ✅ | ✅ | 開發/測試 | 僅開發依賴 | 2026-09-29 |
| 套件 | @axe-core/playwright | npm | MPL-2.0 | ✅（檔案級 copyleft；僅測試用，不隨產品散布） | — | 無障礙測試 | 僅開發依賴 | 2026-09-29 |
| 套件 | @gltf-transform/core、gltf-validator | npm | MIT／Apache-2.0 | ✅ | ✅ | 資產管線 | P2 catalog-tools | 2026-09-29 |
| 套件 | NestJS、drizzle-orm、pg、bullmq、ioredis、jose、ajv、yaml、pngjs、cookie-parser | npm | MIT（pg／ioredis MIT、bullmq MIT） | ✅ | ✅ | 後端 P3/P4 | licenses:check 自動掃描 | 2026-09-30 |
| 套件 | @aws-sdk/client-s3、s3-request-presigner | npm | Apache-2.0 | ✅ | ✅ | 物件儲存 |  | 2026-09-30 |
| 套件 | testcontainers、supertest、openapi-typescript | npm | MIT | ✅ | ✅ | 測試/型別生成 | 僅開發依賴 | 2026-09-30 |
| 映像 | bitnamilegacy/minio | Docker Hub | AGPL-3.0（MinIO 伺服器） | 僅開發/測試 | — | 本機 S3 | **不隨產品散布**；正式環境用雲端 S3（ADR-018） | 2026-09-30 |
| 套件 | fastapi、uvicorn、pydantic、python-multipart | PyPI | MIT／BSD-3／Apache-2.0 | ✅ | ✅ | cv-service |  | 2026-09-30 |
| 套件 | numpy、opencv-python-headless、scikit-image、shapely、pillow | PyPI | BSD-3／Apache-2.0／BSD-3／BSD-3／HPND | ✅ | ✅ | cv-service（點陣管線） |  | 2026-09-30 |
| 套件 | pytesseract＋Tesseract OCR | PyPI／系統套件 | Apache-2.0 | ✅ | ✅ | 尺寸標註 OCR | 缺席時尺度走使用者校正 | 2026-09-30 |
| 資料 | 合成平面圖（services/cv-service/synth） | 專案自產 | 自有 | ✅ | ✅ | 評測/回歸 | P5 評測只用合成資料；**未使用任何第三方資料集或預訓練模型** | 2026-09-30 |

## 供應商與資料集現況（〔待查證〕項目需人處理）
- CubiCasa5K：非商用，**MUST NOT 進入商用版**；商用前取得授權或不使用（P5 決策）。
- ResPlan：授權待核對。
- OpenAI / BFL 等供應商：服務條款、輸出權利、資料保留與訓練條款均〔待查證：尚未核對〕；未核對前不得宣稱 ZDR。
- DWG 轉檔（ODA/LibreDWG）：授權疑慮，預設要求使用者提供 DXF；需法務確認。
- 字型 Noto Sans TC（OFL）：登記於上表原有列。
- 3D 素材：目前無外部素材；P2 只用自產參數化模組（授權：專案自有，`allowed_use` 全部）。之後每件逐筆登記。

## 第一輪盤點結論（2026-09-29）
- 目前已規劃的 npm 套件皆為可商用授權；MPL-2.0 僅限測試工具。
- 阻擋項：CubiCasa5K 商用、DWG 轉檔、各 AI 供應商條款（均為 P4/P5 才會實際引入）。

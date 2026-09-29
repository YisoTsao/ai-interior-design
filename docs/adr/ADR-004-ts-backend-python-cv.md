# ADR-004 後端 TypeScript，CV 用 Python 微服務
狀態：接受
日期：2026-09-29
背景：前後端共用型別；CV 生態在 Python。
決策：NestJS（TS）為 API/Worker；`services/cv-service` 用 FastAPI + ONNX Runtime + ezdxf。
選項與取捨：Fastify（可行，偏離需另寫 ADR）。
後果：跨語言契約以 `PlanResult` JSON Schema 為準，兩端各有契約測試。

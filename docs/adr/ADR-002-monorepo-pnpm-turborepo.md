# ADR-002 Monorepo（pnpm + Turborepo）
狀態：接受
日期：2026-09-29
背景：核心套件需共用於 Web、Desktop、Server。
決策：pnpm workspaces + Turborepo；TypeScript strict。
選項與取捨：多 repo（型別同步成本高）、Nx（可行，學習成本較高）。
後果：CI 需 affected 快取；套件邊界以 eslint 規則強制（core-geometry / scene-schema 不得依賴 React/three/DOM）。

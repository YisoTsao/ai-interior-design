import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './i18n';
import './styles.css';
import { ProjectsPage } from './pages/Projects';
import { EditorPage } from './pages/Editor';
import { ShareViewPage } from './pages/ShareView';
import { PlanReviewPage } from './features/plan-review/PlanReview';
import { initUserAssets } from './userAssets';

// 使用者上傳的 3D 模型（IndexedDB）→ 資產目錄
void initUserAssets();

const router = createBrowserRouter([
  { path: '/', element: <ProjectsPage /> },
  { path: '/projects', element: <ProjectsPage /> },
  { path: '/p/:id/edit', element: <EditorPage /> },
  { path: '/import/:id', element: <PlanReviewPage /> },
  { path: '/view', element: <ShareViewPage /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

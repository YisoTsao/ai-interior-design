import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './i18n';
import './styles.css';
import { ProjectsPage } from './pages/Projects';
import { EditorPage } from './pages/Editor';
import { PlanReviewPage } from './features/plan-review/PlanReview';

const router = createBrowserRouter([
  { path: '/', element: <ProjectsPage /> },
  { path: '/projects', element: <ProjectsPage /> },
  { path: '/p/:id/edit', element: <EditorPage /> },
  { path: '/import/:id', element: <PlanReviewPage /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './i18n';
import './styles.css';
import { ProjectsPage } from './pages/Projects';
import { EditorPage } from './pages/Editor';

const router = createBrowserRouter([
  { path: '/', element: <ProjectsPage /> },
  { path: '/projects', element: <ProjectsPage /> },
  { path: '/p/:id/edit', element: <EditorPage /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

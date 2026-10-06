import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './ui/theme.css';

const GamePage = lazy(() => import('./ui/GamePage'));
const LabPage = lazy(() => import('./lab/LabPage'));
const AdminPage = lazy(() => import('./admin/AdminPage'));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>加载中…</div>}>
              <GamePage />
            </Suspense>
          }
        />
        <Route
          path="/lab"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>加载中…</div>}>
              <LabPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>加载中…</div>}>
              <AdminPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

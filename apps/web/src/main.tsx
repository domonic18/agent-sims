import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { BootScreen } from './ui/BootScreen';
import './ui/theme.css';

void useAuthStore.getState().restore();

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
            <Suspense fallback={<BootScreen text="正在加载游戏引擎…" />}>
              <GamePage />
            </Suspense>
          }
        />
        <Route
          path="/lab"
          element={
            <Suspense fallback={<BootScreen text="正在加载调试台…" />}>
              <LabPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<BootScreen text="正在加载后台…" />}>
              <AdminPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

// React 已接管(路由级 BootScreen 与 index.html 静态版同款无缝衔接),摘除首字节加载屏
document.getElementById('boot-screen')?.remove();

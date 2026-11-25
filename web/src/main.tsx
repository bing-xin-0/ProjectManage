import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import Reports from './pages/Reports';
import PublicShare from './pages/PublicShare';
import Login from './pages/Login';
import { getToken } from './api';

function Root() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getToken()));

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/project/:id" element={<ProjectDetail />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/share/:shareToken" element={<PublicShare />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
import { Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider.tsx';
import Layout from './components/Layout.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import Home from './pages/Home.tsx';
import Login from './pages/Login.tsx';
import NotFound from './pages/NotFound.tsx';

// Send, Receive and History pages are added in later phases (see docs/TASKS.md).
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route index element={<Home />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

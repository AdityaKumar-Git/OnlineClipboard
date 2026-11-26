import { Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider.tsx';
import Layout from './components/Layout.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import Login from './pages/Login.tsx';
import NotFound from './pages/NotFound.tsx';
import Receive from './pages/Receive.tsx';
import Send from './pages/Send.tsx';

// The History page is added in Phase 6 (see docs/TASKS.md).
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<Login />} />
          {/* Receiving needs only a PIN, no account. */}
          <Route path="/receive" element={<Receive />} />
          <Route element={<ProtectedRoute />}>
            <Route index element={<Send />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

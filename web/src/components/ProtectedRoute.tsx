import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth.ts';

/** Renders child routes only for signed-in users; otherwise sends them to /login. */
export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }
  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

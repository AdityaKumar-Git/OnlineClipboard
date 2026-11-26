import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth.ts';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Online Clipboard
        </Link>
        {user && (
          <div className="user-menu">
            <span className="user-name" title={user.email}>
              {user.name ?? user.email}
            </span>
            <button type="button" className="button" onClick={handleLogout} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

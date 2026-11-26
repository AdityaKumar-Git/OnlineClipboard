import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth.ts';

export default function Layout() {
  const { status, user, logout } = useAuth();
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
        <Link to={user ? '/' : '/receive'} className="brand">
          Online Clipboard
        </Link>
        <nav className="nav" aria-label="Main">
          {user && (
            <NavLink to="/" end>
              Send
            </NavLink>
          )}
          <NavLink to="/receive">Receive</NavLink>
        </nav>
        <div className="user-menu">
          {user ? (
            <>
              <span className="user-name" title={user.email}>
                {user.name ?? user.email}
              </span>
              <button type="button" className="button" onClick={handleLogout} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            status === 'signed-out' && (
              <Link to="/login" className="button">
                Sign in
              </Link>
            )
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

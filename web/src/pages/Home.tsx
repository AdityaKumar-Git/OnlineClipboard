import { useAuth } from '../auth/useAuth.ts';

// Placeholder for the Send page (Phase 2).
export default function Home() {
  const { user } = useAuth();

  return (
    <section>
      <h1>Online Clipboard</h1>
      <p>Share text and files across devices with a short-lived PIN.</p>
      <p className="muted">Signed in as {user?.email}.</p>
    </section>
  );
}

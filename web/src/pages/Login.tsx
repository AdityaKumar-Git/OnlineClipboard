import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth.ts';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. Try again when you are ready.',
  state_mismatch: 'Your sign-in session expired. Please try again.',
  signin_failed: 'Google sign-in failed. Please try again.',
};

export default function Login() {
  const { status, error: serverError } = useAuth();
  const [params] = useSearchParams();
  const errorCode = params.get('error');

  if (status === 'signed-in') return <Navigate to="/" replace />;

  const message = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.signin_failed) : serverError;

  return (
    <section className="login">
      <h1>Sign in</h1>
      <p>Sign in with Google to share text and files with a short-lived PIN.</p>
      {message && (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      )}
      {/* Full-page navigation: the server redirects to Google's consent screen. */}
      <a className="button button-primary" href="/auth/google">
        Sign in with Google
      </a>
    </section>
  );
}

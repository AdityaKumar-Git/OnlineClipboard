import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api.ts';

type Checks = { db: string; redis: string };
type State =
  { kind: 'loading' } | { kind: 'ok'; checks: Checks } | { kind: 'error'; message: string; checks?: Checks };

function describe(checks: Checks) {
  return `database: ${checks.db}, redis: ${checks.redis}`;
}

export default function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ status: string; checks: Checks }>('/api/health')
      .then((body) => {
        if (!cancelled) setState({ kind: 'ok', checks: body.checks });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 503) {
          const checks = (err.body as { checks?: Checks } | null)?.checks;
          setState({ kind: 'error', message: err.message, checks });
        } else {
          setState({ kind: 'error', message: 'API server is not reachable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1>Online Clipboard</h1>
      <p>Share text and files across devices with a short-lived PIN.</p>
      <div className={`status status-${state.kind}`} role="status">
        {state.kind === 'loading' && 'Checking server…'}
        {state.kind === 'ok' && `Server healthy (${describe(state.checks)})`}
        {state.kind === 'error' &&
          `Server problem: ${state.message}${state.checks ? ` (${describe(state.checks)})` : ''}`}
      </div>
    </section>
  );
}

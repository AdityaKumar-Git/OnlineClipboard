import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import CopyButton from '../components/CopyButton.tsx';
import { ApiError } from '../lib/api.ts';
import { PIN_LENGTH, cleanPinInput, receiveShare, type ReceivedShare } from '../lib/shares.ts';

export default function Receive() {
  const [params] = useSearchParams();
  const [pin, setPin] = useState(() => cleanPinInput(params.get('pin') ?? ''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceivedShare | null>(null);

  const complete = pin.length === PIN_LENGTH;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!complete || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await receiveShare(pin));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('That PIN is wrong or has expired.');
      else if (err instanceof ApiError && err.status === 429) setError(err.message);
      else setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1>Receive</h1>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">PIN</span>
          <input
            className="pin-input"
            value={pin}
            onChange={(e) => setPin(cleanPinInput(e.target.value))}
            placeholder="ABC234"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={PIN_LENGTH + 4}
            aria-describedby="pin-help"
            autoFocus
          />
          <span id="pin-help" className="small muted">
            6 characters from the sending device. No sign-in needed.
          </span>
        </label>
        <div>
          <button type="submit" className="button button-primary" disabled={!complete || loading}>
            {loading ? 'Opening…' : 'Open'}
          </button>
        </div>
      </form>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {result?.kind === 'text' && (
        <div className="card stack">
          <div className="row">
            <span className="field-label">Shared text</span>
            <CopyButton text={result.text} />
          </div>
          <pre className="received-text">{result.text}</pre>
        </div>
      )}
    </section>
  );
}

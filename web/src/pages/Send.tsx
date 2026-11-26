import { useState, type FormEvent } from 'react';
import PinCard from '../components/PinCard.tsx';
import { ApiError } from '../lib/api.ts';
import {
  DEFAULT_TTL_MINUTES,
  MAX_TEXT_BYTES,
  TTL_OPTIONS_MINUTES,
  createTextShare,
  textByteLength,
  type CreatedShare,
  type ShareMode,
} from '../lib/shares.ts';

function formatKb(bytes: number) {
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

export default function Send() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ShareMode>('TEMP');
  const [ttlMinutes, setTtlMinutes] = useState(DEFAULT_TTL_MINUTES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ share: CreatedShare; mode: ShareMode } | null>(null);

  const bytes = textByteLength(text);
  const tooLarge = bytes > MAX_TEXT_BYTES;
  const empty = text.trim().length === 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (empty || tooLarge || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const share = await createTextShare({ text, mode, ttlMinutes });
      setCreated({ share, mode });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        setError('Your session has ended. Please sign in again.');
      else if (err instanceof ApiError && err.status < 500) setError(err.message);
      else setError('Could not create a PIN. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCreated(null);
    setText('');
    setError(null);
  }

  if (created) {
    return (
      <section>
        <h1>Share created</h1>
        <PinCard key={created.share.id} share={created.share} mode={created.mode} />
        <button type="button" className="button" onClick={reset}>
          Share something else
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Send</h1>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste or type the text to share"
            aria-describedby="text-size"
            aria-invalid={tooLarge}
            autoFocus
          />
          <span id="text-size" className={`small ${tooLarge ? 'text-error' : 'muted'}`}>
            {formatKb(bytes)} / {formatKb(MAX_TEXT_BYTES)}
            {tooLarge && ' (too large)'}
          </span>
        </label>

        <fieldset className="field">
          <legend className="field-label">After the PIN expires</legend>
          <label className="radio">
            <input type="radio" name="mode" checked={mode === 'TEMP'} onChange={() => setMode('TEMP')} />
            Delete it (temporary)
          </label>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              checked={mode === 'HISTORY'}
              onChange={() => setMode('HISTORY')}
            />
            Keep it in my history
          </label>
        </fieldset>

        <label className="field">
          <span className="field-label">PIN valid for</span>
          <select value={ttlMinutes} onChange={(e) => setTtlMinutes(Number(e.target.value))}>
            {TTL_OPTIONS_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? 'minute' : 'minutes'}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}

        <div>
          <button type="submit" className="button button-primary" disabled={empty || tooLarge || submitting}>
            {submitting ? 'Creating PIN…' : 'Create PIN'}
          </button>
        </div>
      </form>
    </section>
  );
}

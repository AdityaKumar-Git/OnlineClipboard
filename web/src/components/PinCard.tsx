import { formatDuration, useCountdown } from '../hooks/useCountdown.ts';
import type { CreatedShare, ShareMode } from '../lib/shares.ts';
import CopyButton from './CopyButton.tsx';

export default function PinCard({ share, mode }: { share: CreatedShare; mode: ShareMode }) {
  const secondsLeft = useCountdown(share.pinExpiresAt);
  const expired = secondsLeft === 0;
  const receiveUrl = `${window.location.origin}/receive`;

  return (
    <div className={`card pin-card${expired ? ' pin-card-expired' : ''}`}>
      <p className="muted">Your PIN</p>
      <p className="pin" aria-label={`PIN ${share.pin.split('').join(' ')}`}>
        {share.pin}
      </p>
      <p className="pin-timer" role="timer" aria-live="off">
        {expired ? 'PIN expired' : `Expires in ${formatDuration(secondsLeft)}`}
      </p>
      {!expired && <CopyButton text={share.pin} label="Copy PIN" />}
      <p className="muted small">
        On the other device, open <strong>{receiveUrl}</strong> and enter this PIN.
        <br />
        {mode === 'TEMP'
          ? 'The text is deleted after the PIN expires.'
          : 'The text stays in your history after the PIN expires.'}
      </p>
    </div>
  );
}

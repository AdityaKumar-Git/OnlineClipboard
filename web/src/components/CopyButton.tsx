import { useEffect, useState } from 'react';

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (e.g. opening the dev server by LAN IP on a phone).
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  if (!ok) throw new Error('copy failed');
}

export default function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(id);
  }, [state]);

  async function handleClick() {
    try {
      await copyToClipboard(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button type="button" className="button" onClick={handleClick} aria-live="polite">
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}

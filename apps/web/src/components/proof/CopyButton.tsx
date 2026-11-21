import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Tombol salin dengan umpan balik "Tersalin" ~2 detik. navigator.clipboard tidak ada di konteks
 * non-HTTPS dan bisa ditolak izin, jadi kegagalan ditampilkan sebagai pesan, tidak diam-diam.
 */
export function CopyButton({ value, label, what }: { value: string | null | undefined; label: string; what: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!value) return;
    clearTimeout(timer.current);
    let next: CopyState = 'copied';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API tidak tersedia');
      await navigator.clipboard.writeText(value);
    } catch {
      next = 'failed';
    }
    setState(next);
    timer.current = setTimeout(() => setState('idle'), next === 'failed' ? 4000 : 2000);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => void copy()}
        disabled={!value}
        aria-label={`Salin ${what}`}
      >
        {state === 'copied' ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {state === 'copied' ? 'Tersalin' : label}
      </button>
      <span role="status" aria-live="polite" className="text-xs">
        {state === 'copied' && <span className="sr-only">{what} tersalin ke clipboard</span>}
        {state === 'failed' && <span className="text-red-600">Gagal menyalin {what}. Salin manual dari kotak di atas.</span>}
      </span>
    </span>
  );
}

import { FileText, Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { errorMessage, openSignedFile } from '../lib/api';

/**
 * Tombol pembuka file. Link biasa tidak membawa header identitas (mode demo), jadi file
 * campaign yang belum publik akan ditolak; tombol ini meminta link bertanda tangan dulu.
 * `linkPath` = endpoint yang mengembalikan { url }, mis. /documents/:id/link.
 */
export function FileButton({ linkPath, children, className = 'btn-secondary btn-sm' }: { linkPath: string; children: ReactNode; className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={() => {
          setError(null);
          setLoading(true);
          openSignedFile(linkPath)
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setLoading(false));
        }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        {children}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

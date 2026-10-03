import { FileText, Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { errorMessage, openProtectedFile } from '../lib/api';

/** Tombol pembuka file yang tetap membawa identitas pengguna (lihat openProtectedFile). */
export function FileButton({ path, children, className = 'btn-secondary btn-sm' }: { path: string; children: ReactNode; className?: string }) {
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
          openProtectedFile(path)
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

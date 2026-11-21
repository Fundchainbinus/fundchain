import { Loader2 } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { ErrorBox } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Jebak fokus di dalam `ref` selama `active`: fokus awal ke `initialFocus` (atau elemen fokusabel pertama),
 * Tab/Shift+Tab berputar di dalam kontainer, Esc memanggil `onEscape`, dan saat nonaktif fokus
 * dikembalikan ke elemen yang memicu (bila masih ada di DOM).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
  /** Elemen tujuan fokus saat ditutup; diutamakan (Safari/iOS tidak memfokuskan tombol saat diklik). */
  returnFocus?: RefObject<HTMLElement | null>,
) {
  // Simpan callback di ref agar efek tidak berjalan ulang (dan mencuri fokus) di setiap render.
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    (initialFocus?.current ?? focusables()[0] ?? container).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        escRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        // Semua tombol nonaktif (mis. saat pending): tahan fokus di kontainer.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !container.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const target = returnFocus?.current?.isConnected ? returnFocus.current : trigger;
      if (target?.isConnected) target.focus();
    };
  }, [active, ref, initialFocus, returnFocus]);
}

/** Dialog konfirmasi untuk aksi admin yang tidak bisa dibatalkan (approve, cairkan, tandai paid). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Batal',
  danger,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(boxRef, open, () => !pending && onCancel(), cancelRef);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !pending && onCancel()}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        tabIndex={-1}
        className="card w-full max-w-md p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <div id={`${id}-desc`} className="mt-2 text-sm text-slate-600 [overflow-wrap:anywhere]">
          {children}
        </div>
        {!!error && (
          <div className="mt-3">
            <ErrorBox error={error} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

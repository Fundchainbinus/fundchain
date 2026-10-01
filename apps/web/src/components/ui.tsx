import type { BlockchainStatus, CampaignStatus, DisbursementStatus, DonationStatus, IntegrityStatus } from '@fundchain/shared';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, ExternalLink, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { percent, sdg, shortHash } from '../lib/format';

const tone = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-navy-light text-navy',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-violet-100 text-violet-800',
};

const CAMPAIGN: Record<CampaignStatus, [string, keyof typeof tone]> = {
  DRAFT: ['Draft', 'gray'],
  PENDING_REVIEW: ['Menunggu Review', 'amber'],
  ACTIVE: ['Aktif', 'green'],
  REJECTED: ['Ditolak', 'red'],
  FROZEN: ['Dibekukan', 'red'],
  COMPLETED: ['Selesai', 'blue'],
};
const DONATION: Record<DonationStatus, [string, keyof typeof tone]> = {
  PENDING: ['Menunggu Bayar', 'amber'],
  PAID: ['Lunas', 'green'],
  FAILED: ['Gagal', 'red'],
  EXPIRED: ['Kedaluwarsa', 'gray'],
  REFUNDED: ['Dikembalikan', 'gray'],
};
const CHAIN: Record<BlockchainStatus, [string, keyof typeof tone]> = {
  QUEUED: ['Antre', 'gray'],
  SUBMITTED: ['Dikirim', 'blue'],
  CONFIRMED: ['On-chain', 'purple'],
  RETRYING: ['Mencoba ulang', 'amber'],
  FAILED: ['Gagal', 'red'],
};
const DISBURSEMENT: Record<DisbursementStatus, [string, keyof typeof tone]> = {
  REQUESTED: ['Diajukan', 'amber'],
  APPROVED: ['Disetujui', 'blue'],
  REJECTED: ['Ditolak', 'red'],
  PAID: ['Dicairkan', 'green'],
};

function Badge({ label, t, icon }: { label: string; t: keyof typeof tone; icon?: ReactNode }) {
  return <span className={`badge ${tone[t]}`}>{icon}{label}</span>;
}

export const CampaignBadge = ({ status }: { status: CampaignStatus }) => <Badge label={CAMPAIGN[status][0]} t={CAMPAIGN[status][1]} />;
export const DonationBadge = ({ status }: { status: DonationStatus }) => <Badge label={DONATION[status][0]} t={DONATION[status][1]} />;
export const DisbursementBadge = ({ status }: { status: DisbursementStatus }) => (
  <Badge label={DISBURSEMENT[status][0]} t={DISBURSEMENT[status][1]} />
);
export function ChainBadge({ status }: { status: BlockchainStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const [label, t] = CHAIN[status];
  const icon = status === 'SUBMITTED' || status === 'QUEUED' || status === 'RETRYING' ? <Clock size={12} /> : undefined;
  return <Badge label={label} t={t} icon={icon} />;
}

export function IntegrityBadge({ status, large }: { status: IntegrityStatus; large?: boolean }) {
  const size = large ? 16 : 12;
  const map = {
    VERIFIED: { label: 'Terverifikasi', t: 'green' as const, icon: <ShieldCheck size={size} /> },
    TAMPERED: { label: 'TAMPERED', t: 'red' as const, icon: <ShieldAlert size={size} /> },
    PENDING: { label: 'Belum dicek', t: 'gray' as const, icon: <ShieldQuestion size={size} /> },
  }[status];
  return (
    <span className={`badge ${tone[map.t]} ${large ? 'px-3 py-1 text-sm' : ''}`}>
      {map.icon}
      {map.label}
    </span>
  );
}

export function SdgTag({ code }: { code: string }) {
  const s = sdg(code);
  if (!s) return null;
  return (
    <span className="badge bg-accent-light text-amber-900" title={s.label}>
      SDG {s.number} · {s.label}
    </span>
  );
}

export function ProgressBar({ current, target }: { current: number; target: number }) {
  const p = percent(current, target);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}

export function HashText({ value, full, label }: { value: string | null | undefined; full?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <code className={`mono rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 ${full ? 'break-all' : ''}`} title={value}>
        {full ? value : shortHash(value)}
      </code>
      <button
        type="button"
        className="shrink-0 text-slate-400 hover:text-navy"
        aria-label={`Salin ${label ?? 'hash'}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      </button>
    </span>
  );
}

export function ExplorerLink({ url, txHash }: { url: string | null; txHash: string | null }) {
  if (!txHash) return <span className="text-slate-400">—</span>;
  if (!url) return <HashText value={txHash} label="tx hash" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-navy hover:underline">
      {shortHash(txHash)} <ExternalLink size={12} />
    </a>
  );
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="animate-spin" size={18} /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, danger }: { label: string; value: ReactNode; hint?: ReactNode; danger?: boolean }) {
  return (
    <div className={`card p-4 ${danger ? 'border-red-200 bg-red-50' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${danger ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** Dialog sederhana untuk input alasan (reject/freeze/unfreeze). */
export function ReasonDialog({
  open,
  title,
  confirmLabel,
  danger,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <label className="label mt-4" htmlFor="reason">Alasan (min. 10 karakter)</label>
        <textarea id="reason" className="input min-h-[100px]" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        <div className="mt-3"><ErrorBox error={error} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={pending}>Batal</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={pending || reason.trim().length < 10}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

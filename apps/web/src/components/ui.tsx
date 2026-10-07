import type { BlockchainStatus, CampaignStatus, DisbursementStatus, DonationStatus, IntegrityStatus } from '@fundchain/shared';
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Info, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { percent, sdg, shortHash } from '../lib/format';

const tone = {
  sky: 'bg-[#EEF8FC] text-ink',
  gray: 'bg-slate-100 text-slate-600',
  blue: 'bg-navy-light text-navy-dark',
  green: 'bg-[#EAF6EF] text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-[#FFF0EF] text-red-600',
  purple: 'bg-violet-50 text-violet-700',
};

const CAMPAIGN: Record<CampaignStatus, [string, keyof typeof tone]> = {
  DRAFT: ['Draft', 'gray'],
  PENDING_REVIEW: ['Pending', 'amber'],
  ACTIVE: ['Active', 'sky'],
  REJECTED: ['Rejected', 'red'],
  FROZEN: ['Frozen', 'red'],
  COMPLETED: ['Completed', 'green'],
};
const DONATION: Record<DonationStatus, [string, keyof typeof tone]> = {
  PENDING: ['Pending', 'amber'],
  PAID: ['Paid', 'green'],
  FAILED: ['Failed', 'red'],
  EXPIRED: ['Expired', 'gray'],
  REFUNDED: ['Refunded', 'gray'],
};
const CHAIN: Record<BlockchainStatus, [string, keyof typeof tone]> = {
  QUEUED: ['Queued', 'gray'],
  SUBMITTED: ['Submitted', 'blue'],
  CONFIRMED: ['Confirmed', 'green'],
  RETRYING: ['Retrying', 'amber'],
  FAILED: ['Failed', 'red'],
};
const DISBURSEMENT: Record<DisbursementStatus, [string, keyof typeof tone]> = {
  REQUESTED: ['Requested', 'gray'],
  APPROVED: ['Approved', 'gray'],
  REJECTED: ['Rejected', 'red'],
  PAID: ['Paid', 'green'],
};

// Di tabel Figma status tampil sebagai teks berwarna, bukan pil.
const plainTone: Record<keyof typeof tone, string> = {
  sky: 'text-ink',
  gray: 'text-ink',
  blue: 'text-navy-dark',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
  purple: 'text-violet-700',
};

function Badge({ label, t, icon }: { label: string; t: keyof typeof tone; icon?: ReactNode }) {
  return <span className={`badge ${tone[t]}`}>{icon}{label}</span>;
}

function StatusText({ label, t, upper = true }: { label: string; t: keyof typeof tone; upper?: boolean }) {
  return <span className={`whitespace-nowrap text-xs ${upper ? 'uppercase' : ''} ${plainTone[t]}`}>{label}</span>;
}

export const CampaignBadge = ({ status }: { status: CampaignStatus }) => <Badge label={CAMPAIGN[status][0]} t={CAMPAIGN[status][1]} />;
export const DonationBadge = ({ status }: { status: DonationStatus }) => <StatusText label={DONATION[status][0]} t={DONATION[status][1]} />;
export const DisbursementBadge = ({ status }: { status: DisbursementStatus }) => (
  <StatusText label={DISBURSEMENT[status][0]} t={DISBURSEMENT[status][1]} />
);
export function ChainBadge({ status }: { status: BlockchainStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const [label, t] = CHAIN[status];
  return <StatusText label={label} t={t} upper={false} />;
}

export function IntegrityBadge({ status, large }: { status: IntegrityStatus; large?: boolean }) {
  const size = large ? 16 : 12;
  const map = {
    VERIFIED: { label: 'Verified', t: 'green' as const, icon: <ShieldCheck size={size} /> },
    TAMPERED: { label: 'Tampered', t: 'red' as const, icon: <ShieldAlert size={size} /> },
    PENDING: { label: 'Pending', t: 'gray' as const, icon: <ShieldQuestion size={size} /> },
  }[status];
  if (!large) return <StatusText label={map.label} t="gray" />;
  return (
    <span className={`badge ${tone[map.t]} px-3 py-1 text-sm`}>
      {map.icon}
      {map.label}
    </span>
  );
}

export function SdgTag({ code }: { code: string }) {
  const s = sdg(code);
  if (!s) return null;
  return (
    <span className="inline-block min-w-0 break-words text-xs text-slate-500" title={s.label}>
      SDG {s.number} · {s.label}
    </span>
  );
}

export function ProgressBar({ current, target, danger }: { current: number; target: number; danger?: boolean }) {
  const p = percent(current, target);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E8EEF1]" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${danger ? 'bg-[#C83D36]' : 'bg-navy'}`} style={{ width: `${p}%` }} />
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
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Kartu statistik. Admin (Frame-1): angka kecil tebal; mahasiswa (Pengunjung.png): angka besar tipis. */
export function Stat({ label, value, hint, danger, large }: { label: ReactNode; value: ReactNode; hint?: ReactNode; danger?: boolean; large?: boolean }) {
  return (
    <div className={`rounded-[10px] border border-line bg-white ${large ? 'px-4 py-4' : 'px-3 py-3'}`}>
      <p className={`${large ? 'text-[13px]' : 'text-xs'} text-slate-500`}>{label}</p>
      <p className={`mt-1 ${large ? 'text-[26px] font-normal' : 'text-[15px] font-bold'} ${danger ? 'text-red-700' : 'text-ink'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Tab filter ala Figma: tombol outline kecil dengan jumlah, yang aktif bertepi biru. */
export function FilterTabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
}: {
  items: { value: T; label: string; count?: number; tone?: 'green' | 'red' }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      {items.map((t) => {
        const active = t.value === value;
        const toneCls = t.tone === 'green' ? 'text-emerald-700' : t.tone === 'red' ? 'text-red-600' : '';
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`rounded border transition ${size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-3 py-1.5 text-xs'} ${
              active
                ? 'border-navy bg-navy-light font-semibold text-ink'
                : `${size === 'sm' ? 'border-transparent bg-slate-100' : 'border-line bg-white'} text-slate-500 hover:text-ink ${toneCls}`
            }`}
          >
            {t.label}
            {t.count !== undefined && ` (${t.count})`}
          </button>
        );
      })}
    </div>
  );
}

/** Kartu bertajuk; judul kecil di atas kartu seperti "Detail Kampanye" di Figma. */
export function Panel({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 ${className}`}>
      {(title || aside) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="section-title">{title}</h2>}
          {aside}
        </div>
      )}
      <div className="card p-4">{children}</div>
    </section>
  );
}

export function InfoNote({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'red' }) {
  const cls = {
    blue: 'border-transparent bg-[#EEF8FC] text-ink',
    amber: 'border-transparent bg-[#FFF5E7] text-ink',
    red: 'border-transparent bg-[#FFF0EF] text-ink',
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] ${cls}`}>
      <Info size={15} className={`mt-0.5 shrink-0 ${tone === 'blue' ? 'text-navy' : tone === 'amber' ? 'text-accent' : 'text-red-600'}`} />
      <div>{children}</div>
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

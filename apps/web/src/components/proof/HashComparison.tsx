import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert, WifiOff } from 'lucide-react';
import type { DonationProof } from '../../lib/types';
import { type ProofVerdict, verdictText } from './proofState';

const STYLE: Record<ProofVerdict['kind'], { box: string; icon: typeof CheckCircle2 }> = {
  match: { box: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: CheckCircle2 },
  mismatch: { box: 'border-red-400 bg-red-50 text-red-800', icon: ShieldAlert },
  'rpc-error': { box: 'border-amber-300 bg-amber-50 text-amber-900', icon: WifiOff },
  'request-error': { box: 'border-amber-300 bg-amber-50 text-amber-900', icon: WifiOff },
  'missing-onchain': { box: 'border-red-300 bg-red-50 text-red-800', icon: AlertTriangle },
  'notarize-failed': { box: 'border-red-300 bg-red-50 text-red-800', icon: AlertTriangle },
  pending: { box: 'border-slate-200 bg-slate-50 text-slate-700', icon: Clock },
  'not-paid': { box: 'border-slate-200 bg-slate-50 text-slate-700', icon: Clock },
  'not-comparable': { box: 'border-sky-200 bg-[#EEF8FC] text-ink', icon: Info },
};

/** Teks yang tampil di kotak "hash on-chain" bila hash asli dari chain tidak tersedia. Tidak pernah memakai hash DB. */
export function onChainPlaceholder(v: ProofVerdict | null): string {
  switch (v?.kind) {
    case undefined:
      return 'Membaca blockchain…';
    case 'not-paid':
    case 'pending':
      return 'Belum dinotarisasi';
    case 'notarize-failed':
      return 'Tidak tercatat (notarisasi gagal)';
    case 'rpc-error':
      return 'Tidak bisa membaca blockchain saat ini';
    case 'request-error':
      return 'Tidak tersedia (gagal memuat bukti)';
    default:
      return 'Tidak ditemukan di smart contract';
  }
}

export function VerdictBanner({ verdict }: { verdict: ProofVerdict | null }) {
  const s = verdict ? STYLE[verdict.kind] : STYLE.pending;
  const Icon = s.icon;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${s.box}`} role="status" aria-live="polite">
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{verdictText(verdict)}</span>
    </div>
  );
}

/** Hash DB berdampingan dengan hash on-chain asli dari RPC, plus indikator cocok/tidak. */
export function HashComparison({ proof, dbHash, verdict }: { proof: DonationProof | undefined; dbHash: string | null; verdict: ProofVerdict | null }) {
  const stored = proof?.hashDb ?? dbHash;
  const recomputedDiffers = !!proof?.currentHash && !!stored && proof.currentHash.toLowerCase() !== stored.toLowerCase();
  const bad = verdict?.kind === 'mismatch';
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="label">Hash tersimpan (database)</p>
          <code className="hash-box font-mono">{stored ?? '—'}</code>
        </div>
        <div>
          <p className="label">Hash on-chain (dibaca langsung dari DonationRegistry)</p>
          <code className={`hash-box font-mono ${bad ? 'border-red-400 text-red-700' : ''}`}>
            {proof?.hashOnChain ?? <span className="font-sans text-slate-500">{onChainPlaceholder(verdict)}</span>}
          </code>
        </div>
      </div>
      {recomputedDiffers && (
        <div>
          <p className="label text-red-700">Hash dihitung ulang dari data database saat ini</p>
          <code className="hash-box font-mono border-red-400 text-red-700">{proof!.currentHash}</code>
          <p className="mt-1 text-xs text-red-700">Berbeda dari hash yang tersimpan saat pembayaran: data donasi telah berubah.</p>
        </div>
      )}
      <VerdictBanner verdict={verdict} />
      {bad && (
        <p className="text-sm font-medium text-red-800">
          Data donasi di database sudah diubah setelah dicatat ke blockchain. Hash on-chain tidak bisa diubah, sehingga perbedaan ini menjadi bukti manipulasi.
        </p>
      )}
    </div>
  );
}

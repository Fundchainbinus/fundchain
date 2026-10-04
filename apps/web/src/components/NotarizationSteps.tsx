import { Check, Loader2, X } from 'lucide-react';
import { useChainInfo } from '../lib/hooks';
import type { DonationDetail } from '../lib/types';

type StepState = 'done' | 'active' | 'todo' | 'error';

/** Visualisasi alur: Bayar → Hash → Antre → Kirim tx → Konfirmasi → Verifikasi. */
export function NotarizationSteps({ d }: { d: DonationDetail }) {
  const paid = d.status === 'PAID';
  const bc = d.blockchain?.status;
  const confirmed = bc === 'CONFIRMED';
  const chain = useChainInfo();
  // Tunjukkan alasan bila jaringan belum siap, supaya antrean tidak terlihat macet tanpa sebab.
  const waitingChain = paid && (bc === 'QUEUED' || bc === 'RETRYING') && chain.data && !chain.data.ready;
  const steps: { label: string; hint: string; state: StepState }[] = [
    { label: 'Pembayaran lunas', hint: 'Webhook gateway terverifikasi', state: paid ? 'done' : d.status === 'PENDING' ? 'active' : 'error' },
    { label: 'Hash Keccak-256', hint: 'Canonical payload dibuat', state: d.hash ? 'done' : paid ? 'active' : 'todo' },
    {
      label: 'Antre notarisasi',
      hint: waitingChain
        ? `Menunggu jaringan blockchain: ${chain.data!.reason ?? 'belum siap'}. Donasi tetap tercatat lunas.`
        : bc === 'RETRYING' ? `Mencoba ulang (${d.blockchain?.retryCount}x)` : 'Worker relayer',
      state: !paid ? 'todo' : bc === 'FAILED' ? 'error' : bc && bc !== 'QUEUED' && bc !== 'RETRYING' ? 'done' : 'active',
    },
    { label: 'Transaksi dikirim', hint: 'notarize(donationId, hash)', state: confirmed || bc === 'SUBMITTED' ? (confirmed ? 'done' : 'active') : 'todo' },
    { label: 'Tercatat di blok', hint: d.blockchain?.blockNumber ? `Blok #${d.blockchain.blockNumber}` : 'Menunggu konfirmasi', state: confirmed ? 'done' : 'todo' },
    {
      label: 'Integritas',
      hint: d.integrityStatus === 'TAMPERED' ? 'Data tidak cocok!' : 'Hash DB = hash on-chain',
      state: d.integrityStatus === 'VERIFIED' ? 'done' : d.integrityStatus === 'TAMPERED' ? 'error' : confirmed ? 'active' : 'todo',
    },
  ];
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${
              { done: 'bg-emerald-500', active: 'bg-brand', todo: 'bg-slate-200', error: 'bg-red-500' }[s.state]
            }`}
          >
            {s.state === 'done' ? <Check size={14} /> : s.state === 'active' ? <Loader2 size={14} className="animate-spin" /> : s.state === 'error' ? <X size={14} /> : null}
          </span>
          <div>
            <p className={`text-sm font-medium ${s.state === 'todo' ? 'text-slate-400' : 'text-slate-800'}`}>{s.label}</p>
            <p className="text-xs text-slate-500">{s.hint}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

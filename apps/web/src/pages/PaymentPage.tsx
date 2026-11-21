import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DonationStatus } from '@fundchain/shared';
import { ExternalLink, Info, Loader2, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotarizationSteps } from '../components/NotarizationSteps';
import { shouldPollDonation } from '../components/proof/proofState';
import { ErrorBox, Spinner, SuccessBox } from '../components/ui';
import { get, post } from '../lib/api';
import { rupiah } from '../lib/format';
import { useConfig } from '../lib/hooks';
import type { DonationDetail } from '../lib/types';

/** Label status donasi untuk donatur (BFD-57). REFUNDED bukan kegagalan: dana dikembalikan. */
const STATUS_LABEL: Record<DonationStatus, { text: string; cls: string }> = {
  PENDING: { text: 'Menunggu pembayaran', cls: 'bg-amber-50 text-amber-700' },
  PAID: { text: 'Lunas', cls: 'bg-[#EAF6EF] text-emerald-700' },
  EXPIRED: { text: 'Kedaluwarsa', cls: 'bg-slate-100 text-slate-600' },
  FAILED: { text: 'Gagal', cls: 'bg-[#FFF0EF] text-red-600' },
  REFUNDED: { text: 'Dana dikembalikan', cls: 'bg-[#EEF8FC] text-navy-dark' },
};

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return <span className="font-mono">{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

export function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const config = useConfig();
  const qc = useQueryClient();
  const donation = useQuery({
    queryKey: ['donation', id],
    queryFn: () => get<DonationDetail>(`/donations/${id}`),
    // Polling: selama menunggu bayar (termasuk QR yang belum siap) dan selama notarisasi donasi PAID
    // belum final. Berhenti untuk EXPIRED/FAILED/REFUNDED dan notarisasi CONFIRMED/FAILED.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === 'PENDING') return 2000;
      return shouldPollDonation(d.status, d.blockchain?.status) ? 3000 : false;
    },
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'settlement' | 'expire' | 'failed') => post(`/dev/payments/${id}/simulate`, { outcome }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donation', id] }),
  });

  if (donation.isLoading) return <Spinner />;
  if (donation.error) return <ErrorBox error={donation.error} />;
  const d = donation.data!;
  const canSimulate = config.data?.devTools && config.data.paymentProvider === 'mock';

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-sm text-slate-500">
        Donasi untuk <Link className="font-medium text-navy hover:underline" to={`/campaigns/${d.campaign.id}`}>{d.campaign.title}</Link>
      </p>
      <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold">
        {rupiah(d.amount)}{' '}
        <span className={`badge ${STATUS_LABEL[d.status].cls}`} role="status">{STATUS_LABEL[d.status].text}</span>
      </h1>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          {d.status === 'PENDING' && d.payment?.qrString ? (
            <div className="flex flex-col items-center text-center">
              <p className="text-sm font-semibold">Scan QRIS untuk membayar</p>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4" role="img" aria-label={`Kode QRIS pembayaran ${rupiah(d.amount)}`}>
                <QRCodeSVG value={d.payment.qrString} size={200} level="M" />
              </div>
              {d.payment.expiresAt && (
                <p className="mt-3 text-sm text-slate-500">Berlaku <Countdown until={d.payment.expiresAt} /></p>
              )}
              {d.payment.paymentUrl && (
                <a href={d.payment.paymentUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm mt-3">
                  Buka halaman pembayaran <ExternalLink size={12} />
                </a>
              )}
              <p className="mt-4 text-xs text-slate-500">Status diperbarui otomatis setelah gateway mengirim webhook.</p>
              {canSimulate && (
                <div className="mt-5 w-full rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-900">Gateway simulasi (mode demo)</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <button className="btn-primary btn-sm" onClick={() => simulate.mutate('settlement')} disabled={simulate.isPending}>
                      <Zap size={14} /> Simulasi bayar berhasil
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => simulate.mutate('expire')} disabled={simulate.isPending}>Kedaluwarsa</button>
                  </div>
                  <div className="mt-2"><ErrorBox error={simulate.error} /></div>
                </div>
              )}
            </div>
          ) : d.status === 'PAID' ? (
            <div className="space-y-4">
              <SuccessBox>Terima kasih! Pembayaran diterima dan donasi sedang dicatat ke blockchain.</SuccessBox>
              <Link to={`/donations/${d.id}`} className="btn-primary w-full">Lihat bukti donasi</Link>
              <Link to={`/campaigns/${d.campaign.id}`} className="btn-secondary w-full">Kembali ke campaign</Link>
            </div>
          ) : d.status === 'PENDING' ? (
            <div className="flex flex-col items-center py-6 text-center" role="status" aria-live="polite">
              <Loader2 size={28} className="animate-spin text-navy" aria-hidden />
              <p className="mt-3 text-sm font-semibold">Menyiapkan pembayaran…</p>
              <p className="mt-1 text-xs text-slate-500">Kode QRIS sedang dibuat oleh gateway. Halaman ini diperbarui otomatis.</p>
            </div>
          ) : d.status === 'REFUNDED' ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-[#EEF8FC] px-4 py-3 text-sm text-ink" role="status">
                <Info size={16} className="mt-0.5 shrink-0 text-navy" aria-hidden />
                <span>Dana dikembalikan. Donasi ini telah di-refund ke donatur dan tidak lagi dihitung dalam perolehan campaign.</span>
              </div>
              <Link to={`/campaigns/${d.campaign.id}`} className="btn-secondary w-full">Kembali ke campaign</Link>
            </div>
          ) : (
            <div className="space-y-4">
              <ErrorBox error={d.status === 'EXPIRED' ? 'Kedaluwarsa: batas waktu pembayaran habis. Silakan buat donasi baru.' : 'Gagal: pembayaran tidak berhasil diproses. Silakan buat donasi baru.'} />
              <Link to={`/campaigns/${d.campaign.id}`} className="btn-secondary w-full">Kembali ke campaign</Link>
            </div>
          )}
        </div>
        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Perjalanan donasi Anda</h2>
          <NotarizationSteps d={d} />
        </div>
      </div>
    </div>
  );
}

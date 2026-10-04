import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotarizationSteps } from '../components/NotarizationSteps';
import { DonationBadge, ErrorBox, Spinner, SuccessBox } from '../components/ui';
import { get, post } from '../lib/api';
import { rupiah } from '../lib/format';
import { useConfig } from '../lib/hooks';
import type { DonationDetail } from '../lib/types';

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
    // Polling: cepat selama menunggu bayar / notarisasi, berhenti saat semua selesai.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 2000;
      const done = d.status !== 'PENDING' && (d.status !== 'PAID' || d.integrityStatus !== 'PENDING');
      return done ? false : 2000;
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
        Donasi untuk <Link className="font-medium text-brand hover:underline" to={`/campaigns/${d.campaign.id}`}>{d.campaign.title}</Link>
      </p>
      <h1 className="mt-1 flex flex-wrap items-center gap-3 text-lg font-semibold">
        {rupiah(d.amount)} <DonationBadge status={d.status} />
      </h1>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          {d.status === 'PENDING' && d.payment?.qrString ? (
            <div className="flex flex-col items-center text-center">
              <p className="text-sm font-semibold">Scan QRIS untuk membayar</p>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
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
          ) : (
            <div className="space-y-4">
              <ErrorBox error={`Pembayaran ${d.status === 'EXPIRED' ? 'kedaluwarsa' : 'gagal'}. Silakan buat donasi baru.`} />
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

import { hashPayload } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotarizationSteps } from '../components/NotarizationSteps';
import { ChainBadge, DonationBadge, ErrorBox, ExplorerLink, HashText, IntegrityBadge, Row, Spinner } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime, rupiah } from '../lib/format';
import type { DonationDetail, VerifyResult } from '../lib/types';

function VerifyResultCard({ r }: { r: VerifyResult }) {
  const ok = r.status === 'VERIFIED';
  return (
    <div className={`rounded-xl border p-4 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
      <div className="flex items-center gap-2"><IntegrityBadge status={r.status} large /></div>
      <dl className="mt-3 space-y-2 text-xs">
        <div><dt className="text-slate-500">Payload dari data DB saat ini</dt><dd className="mono break-all">{r.currentPayload}</dd></div>
        <div><dt className="text-slate-500">Hash dihitung ulang</dt><dd className="mono break-all">{r.currentHash}</dd></div>
        <div><dt className="text-slate-500">Hash di blockchain</dt><dd className="mono break-all">{r.onChainHash}</dd></div>
      </dl>
      {!ok && (
        <p className="mt-3 text-sm font-medium text-red-800">
          Data donasi di database sudah diubah setelah dicatat ke blockchain. Campaign otomatis dibekukan dan pencairan dana dikunci.
        </p>
      )}
    </div>
  );
}

export function DonationProofPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const donation = useQuery({
    queryKey: ['donation', id],
    queryFn: () => get<DonationDetail>(`/donations/${id}`),
    refetchInterval: (q) => (q.state.data?.blockchain?.status === 'CONFIRMED' ? false : 3000),
  });
  const [local, setLocal] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: () => post<VerifyResult>(`/admin/donations/${id}/verify`),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (donation.isLoading) return <Spinner />;
  if (donation.error) return <ErrorBox error={donation.error} />;
  const d = donation.data!;
  const bc = d.blockchain;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm text-slate-500">
        Bukti donasi untuk <Link className="font-medium text-brand hover:underline" to={`/campaigns/${d.campaign.id}`}>{d.campaign.title}</Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{rupiah(d.amount)}</h1>
        <DonationBadge status={d.status} />
        <IntegrityBadge status={d.integrityStatus} large />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-semibold">Data donasi (off-chain)</h2>
            <dl className="mt-2">
              <Row label="ID donasi"><HashText value={d.id} full label="ID donasi" /></Row>
              <Row label="Donatur">{d.donor.displayName} <span className="text-xs text-slate-500">· pseudonim on-chain {d.donor.integritySubjectId}</span></Row>
              <Row label="Waktu lunas">{dateTime(d.donatedAt)}</Row>
              <Row label="Pembayaran">{d.payment ? `${d.payment.method} via ${d.payment.provider} · ${d.payment.status}` : '—'}</Row>
              <Row label="Pemeriksaan terakhir">{dateTime(d.lastCheckedAt)}</Row>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Sidik jari (hash)</h2>
            <p className="mt-1 text-xs text-slate-500">
              Format: <code className="mono">v1|donationId|integritySubjectId|amount|timestamp</code> → Keccak-256. Tidak ada data pribadi yang masuk ke blockchain.
            </p>
            <dl className="mt-2">
              <Row label="Canonical payload"><code className="mono break-all">{d.canonicalPayload ?? '—'}</code></Row>
              <Row label="Hash tersimpan"><HashText value={d.hash} full /></Row>
            </dl>
            {d.canonicalPayload && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <button className="btn-secondary btn-sm" onClick={() => setLocal(hashPayload(d.canonicalPayload!))}>
                  <Calculator size={14} /> Hitung ulang hash di browser saya
                </button>
                {local && (
                  <p className={`mt-2 text-xs ${local === d.hash ? 'text-emerald-700' : 'text-red-700'}`}>
                    <code className="mono break-all">{local}</code>
                    <br />
                    {local === d.hash ? '✓ Sama dengan hash tersimpan — Keccak-256 bersifat deterministik.' : '✗ Berbeda dengan hash tersimpan.'}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Catatan blockchain</h2>
            {bc ? (
              <dl className="mt-2">
                <Row label="Status"><ChainBadge status={bc.status} /></Row>
                <Row label="Jaringan">{bc.network} (chain ID {bc.chainId})</Row>
                <Row label="Smart contract"><HashText value={bc.contractAddress} label="alamat contract" /></Row>
                <Row label="Key on-chain"><HashText value={bc.onchainKey} label="key" /></Row>
                <Row label="Transaksi"><ExplorerLink url={bc.explorerUrl} txHash={bc.txHash} /></Row>
                <Row label="Blok">{bc.blockNumber ?? '—'}</Row>
                <Row label="Dikonfirmasi">{dateTime(bc.confirmedAt)}</Row>
                {bc.lastError && <Row label="Error terakhir"><span className="text-xs text-red-700">{bc.lastError}</span></Row>}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Belum dinotarisasi (donasi belum lunas).</p>
            )}
          </section>

          {d.viewer.isAdmin && (
            <section className="card border-brand/20 p-5">
              <h2 className="font-semibold">Integrity checker (admin)</h2>
              <p className="mt-1 text-sm text-slate-600">Hitung ulang hash dari data database saat ini lalu bandingkan dengan hash di smart contract.</p>
              <button className="btn-primary mt-3" onClick={() => verify.mutate()} disabled={verify.isPending || bc?.status !== 'CONFIRMED'}>
                <ShieldCheck size={16} /> {verify.isPending ? 'Memeriksa…' : 'Verifikasi ke blockchain'}
              </button>
              <div className="mt-3 space-y-3">
                <ErrorBox error={verify.error} />
                {verify.data && <VerifyResultCard r={verify.data} />}
              </div>
            </section>
          )}
        </div>
        <aside className="card h-fit p-5">
          <h2 className="mb-4 font-semibold">Alur bukti</h2>
          <NotarizationSteps d={d} />
        </aside>
      </div>
    </div>
  );
}

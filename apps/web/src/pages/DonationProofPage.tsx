import { hashPayload } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, InfoNote, IntegrityBadge, Panel, Spinner } from '../components/ui';
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

  const steps = [
    { k: 'PAID', ok: d.status === 'PAID', hint: d.donatedAt ? dateTime(d.donatedAt) : 'Menunggu pembayaran' },
    { k: 'HASH', ok: !!d.hash, hint: 'Keccak-256' },
    { k: 'TX', ok: !!bc?.txHash, hint: bc?.txHash ? 'Dikirim relayer' : 'Antre notarisasi' },
    { k: 'BLOCK', ok: !!bc?.blockNumber, hint: bc?.blockNumber ? bc.blockNumber.toLocaleString('id-ID') : 'Menunggu konfirmasi' },
    { k: 'VERIFIED', ok: d.integrityStatus === 'VERIFIED', bad: d.integrityStatus === 'TAMPERED', hint: d.integrityStatus === 'TAMPERED' ? 'Hash tidak cocok' : d.integrityStatus === 'VERIFIED' ? 'Hash sesuai' : 'Belum dicek' },
  ];
  const copy = (v: string | null) => v && void navigator.clipboard.writeText(v);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">
          Bukti donasi untuk <Link className="text-navy hover:underline" to={`/campaigns/${d.campaign.id}`}>{d.campaign.title}</Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="page-title">Bukti Donasi & Notarisasi</h1>
          <span className="text-sm text-ink">{rupiah(d.amount)} · {d.donor.displayName}</span>
        </div>
      </div>

      <div className="card grid gap-3 px-4 py-4 sm:grid-cols-5">
        {steps.map((st) => (
          <div key={st.k}>
            <span className={`badge font-normal ${st.bad ? 'bg-[#FFF0EF] text-red-600' : st.ok ? 'bg-[#EAF6EF] text-emerald-700' : 'bg-[#F1F3F4] text-slate-500'}`}>
              {st.ok ? <Check size={11} /> : st.bad ? <X size={11} /> : null} {st.k}
            </span>
            <p className="mt-2 text-[13px] text-slate-500">{st.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Payload & Hash Bukti" aside={<span className="text-xs text-slate-500">Keccak-256 · UTF-8</span>}>
          <p className="label">Canonical payload · urutan kunci tetap</p>
          <code className="hash-box font-mono">{d.canonicalPayload ?? '—'}</code>
          <p className="label mt-3">Hash tersimpan (DB)</p>
          <code className="hash-box font-mono">{d.hash ?? '—'}</code>
          <p className="mt-2 text-xs text-slate-500">Payload dipertahankan persis saat hashing; perubahan nominal atau data menghasilkan hash berbeda.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => copy(d.canonicalPayload)} disabled={!d.canonicalPayload}><Copy size={12} /> Salin payload</button>
            <button className="btn-secondary btn-sm" onClick={() => copy(d.hash)} disabled={!d.hash}>Salin hash</button>
          </div>
          <div className="mt-3"><InfoNote>Hash ini adalah bukti integritas, bukan saldo atau transfer dana di blockchain. Tidak ada data pribadi yang masuk ke blockchain.</InfoNote></div>
        </Panel>

        <Panel title="Transaksi On-chain & Verifikasi Browser">
          {bc ? (
            <>
              <p className="label">Transaction hash</p>
              <code className="hash-box font-mono">{bc.txHash ?? 'Belum dikirim'}</code>
              <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-xs">
                <div>
                  <p>Block {bc.blockNumber?.toLocaleString('id-ID') ?? '—'}</p>
                  <p>{dateTime(bc.confirmedAt)}</p>
                  <p>Chain ID {bc.chainId} · {bc.network}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`badge font-normal ${bc.status === 'CONFIRMED' ? 'bg-[#EAF6EF] text-emerald-700' : bc.status === 'FAILED' ? 'bg-[#FFF0EF] text-red-600' : 'bg-[#F1F3F4] text-slate-600'}`}>
                    {bc.status}
                  </span>
                  {bc.explorerUrl && (
                    <a href={bc.explorerUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                      Lihat di Etherscan <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
              {bc.lastError && <p className="mt-2 text-xs text-red-600">{bc.lastError}</p>}
              <p className="label mt-3">Hash on-chain · DonationRegistry</p>
              <code className="hash-box font-mono">
                {/* Hash on-chain hanya diketahui setelah dicek integritasnya: VERIFIED berarti sama dengan hash DB. */}
                {d.integrityStatus === 'VERIFIED' ? d.hash : d.integrityStatus === 'TAMPERED' ? 'Tidak sama dengan hash DB' : 'Belum diverifikasi'}
              </code>
            </>
          ) : (
            <p className="text-slate-500">Belum dinotarisasi (donasi belum lunas).</p>
          )}
          {d.canonicalPayload && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-primary btn-sm" onClick={() => setLocal(hashPayload(d.canonicalPayload!))}>
                <ShieldCheck size={14} /> Hitung ulang hash di browser
              </button>
              {local && (
                <span className={`badge ${local === d.hash ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {local === d.hash ? 'Verified · cocok' : 'Tidak cocok'}
                </span>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Contoh hash: hash payload = hash DB = hash on-chain. Verifikasi ulang dilakukan secara lokal di browser.</p>
        </Panel>
      </div>

      {d.viewer.isAdmin && (
        <Panel title="Integrity checker (admin)">
          <p className="text-slate-600">Hitung ulang hash dari data database saat ini lalu bandingkan dengan hash di smart contract.</p>
          <button className="btn-primary btn-sm mt-3" onClick={() => verify.mutate()} disabled={verify.isPending || bc?.status !== 'CONFIRMED'}>
            <ShieldCheck size={14} /> {verify.isPending ? 'Memeriksa…' : 'Verifikasi ke blockchain'}
          </button>
          <div className="mt-3 space-y-3">
            <ErrorBox error={verify.error} />
            {verify.data && <VerifyResultCard r={verify.data} />}
          </div>
        </Panel>
      )}
    </div>
  );
}

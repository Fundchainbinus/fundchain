import { hashPayload } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileDown, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CopyButton } from '../components/proof/CopyButton';
import { HashComparison } from '../components/proof/HashComparison';
import { ProofPrintSheet } from '../components/proof/ProofPrintSheet';
import { deriveVerdict, shouldPollDonation } from '../components/proof/proofState';
import { ErrorBox, InfoNote, IntegrityBadge, Panel, Spinner } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime, rupiah } from '../lib/format';
import type { DonationDetail, DonationProof, VerifyResult } from '../lib/types';

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
    // Pantau hanya selama donasi PAID dan notarisasi belum final (QUEUED/SUBMITTED/RETRYING).
    refetchInterval: (q) => (shouldPollDonation(q.state.data?.status, q.state.data?.blockchain?.status) ? 3000 : false),
  });
  // /proof membaca RPC tiap panggilan (rate limit 30/menit): ambil sekali saat buka, setelah transisi
  // ke CONFIRMED, dan saat tombol "Cek ulang" — tidak pernah di-poll. Key terpisah dari ['donation', id]
  // supaya invalidasi detail donasi tidak ikut memicu pembacaan RPC.
  const proof = useQuery({
    queryKey: ['donation-proof', id],
    queryFn: () => get<DonationProof>(`/donations/${id}/proof`),
    enabled: !!donation.data,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const chainStatus = donation.data?.blockchain?.status;
  const prevChainStatus = useRef(chainStatus);
  const refetchProof = proof.refetch;
  useEffect(() => {
    const prev = prevChainStatus.current;
    prevChainStatus.current = chainStatus;
    if (prev && prev !== 'CONFIRMED' && chainStatus === 'CONFIRMED') void refetchProof();
  }, [chainStatus, refetchProof]);

  const [local, setLocal] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: () => post<VerifyResult>(`/admin/donations/${id}/verify`),
    // Verifikasi bisa membekukan campaign → segarkan semua data (termasuk bukti on-chain).
    onSuccess: () => qc.invalidateQueries(),
  });

  if (donation.isLoading) return <Spinner />;
  if (donation.error) return <ErrorBox error={donation.error} />;
  const d = donation.data!;
  const bc = d.blockchain;
  const p = proof.data;
  const verdict = deriveVerdict(d.status, p, proof.error);
  const mismatch = verdict?.kind === 'mismatch';
  const verified = verdict?.kind === 'match' || (d.integrityStatus === 'VERIFIED' && !mismatch);
  const tampered = mismatch || d.integrityStatus === 'TAMPERED';
  const txHash = p?.txHash ?? bc?.txHash ?? null;
  const explorerUrl = p?.etherscanUrl ?? bc?.explorerUrl ?? null;
  // Hanya proof: polling detail di latar belakang tidak boleh membuat tombol berkedip.
  const rechecking = proof.isFetching;
  // Gagal "Cek ulang" (mis. 429) sementara data lama masih ada: beri tahu, jangan diam-diam.
  const staleProofError = p && proof.error ? proof.error : null;

  const recheck = () => {
    void donation.refetch();
    void proof.refetch();
  };

  const steps = [
    { k: 'PAID', ok: d.status === 'PAID', hint: d.donatedAt ? dateTime(d.donatedAt) : 'Menunggu pembayaran' },
    { k: 'HASH', ok: !!d.hash, hint: 'Keccak-256' },
    { k: 'TX', ok: !!bc?.txHash, hint: bc?.txHash ? 'Dikirim relayer' : 'Antre notarisasi' },
    { k: 'BLOCK', ok: !!bc?.blockNumber, hint: bc?.blockNumber ? bc.blockNumber.toLocaleString('id-ID') : 'Menunggu konfirmasi' },
    { k: 'VERIFIED', ok: verified && !tampered, bad: tampered, hint: tampered ? 'Hash tidak cocok' : verified ? 'Hash sesuai' : 'Belum dicek' },
  ];

  return (
    <div className="space-y-5">
      <ProofPrintSheet d={d} proof={p} verdict={verdict} />

      <div className="space-y-5 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">
              Bukti donasi untuk <Link className="text-navy hover:underline" to={`/campaigns/${d.campaign.id}`}>{d.campaign.title}</Link>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="page-title">Bukti Donasi & Notarisasi</h1>
              <span className="text-sm text-ink">{rupiah(d.amount)} · {d.donor.displayName}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={recheck}
              disabled={rechecking}
              title="Baca ulang status donasi dan hash on-chain dari blockchain"
            >
              <RefreshCw size={12} className={rechecking ? 'animate-spin' : ''} aria-hidden /> {rechecking ? 'Memeriksa…' : 'Cek ulang'}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => window.print()}
              disabled={proof.isLoading}
              title='Membuka dialog cetak browser: pilih "Save as PDF" / "Simpan sebagai PDF" sebagai printer'
              aria-describedby="pdf-hint"
            >
              <FileDown size={12} aria-hidden /> Unduh PDF
            </button>
          </div>
        </div>
        <p id="pdf-hint" className="-mt-3 text-right text-xs text-slate-500">Unduh PDF: di dialog cetak, pilih "Save as PDF".</p>

        <div className="card grid gap-3 px-4 py-4 sm:grid-cols-5">
          {steps.map((st) => (
            <div key={st.k}>
              <span className={`badge font-normal ${st.bad ? 'bg-[#FFF0EF] text-red-600' : st.ok ? 'bg-[#EAF6EF] text-emerald-700' : 'bg-[#F1F3F4] text-slate-500'}`}>
                {st.ok ? <Check size={11} aria-hidden /> : st.bad ? <X size={11} aria-hidden /> : null} {st.k}
              </span>
              <p className="mt-2 text-[13px] text-slate-500">{st.hint}</p>
            </div>
          ))}
        </div>

        <Panel
          title="Hash Database vs Hash On-chain"
          aside={p && <span className="text-xs text-slate-500">Dicek {dateTime(p.checkedAt)}</span>}
        >
          {proof.isLoading && verdict === null ? (
            <Spinner label="Membaca blockchain…" />
          ) : (
            <HashComparison proof={p} dbHash={d.hash} verdict={verdict} />
          )}
          {staleProofError && (
            <p role="status" className="mt-3 text-xs text-amber-800">
              Cek ulang gagal: {staleProofError instanceof Error ? staleProofError.message : String(staleProofError)} Hasil di atas dari pengecekan {p && dateTime(p.checkedAt)}.
            </p>
          )}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Payload & Hash Bukti" aside={<span className="text-xs text-slate-500">Keccak-256 · UTF-8</span>}>
            <p className="label">Canonical payload · urutan kunci tetap</p>
            <code className="hash-box font-mono">{d.canonicalPayload ?? '—'}</code>
            <p className="label mt-3">Hash tersimpan (DB)</p>
            <code className="hash-box font-mono">{d.hash ?? '—'}</code>
            <p className="mt-2 text-xs text-slate-500">Payload dipertahankan persis saat hashing; perubahan nominal atau data menghasilkan hash berbeda.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton value={d.canonicalPayload} label="Salin payload" what="payload" />
              <CopyButton value={d.hash} label="Salin hash" what="hash DB" />
            </div>
            <div className="mt-3"><InfoNote>Hash ini adalah bukti integritas, bukan saldo atau transfer dana di blockchain. Tidak ada data pribadi yang masuk ke blockchain.</InfoNote></div>
          </Panel>

          <Panel title="Transaksi On-chain & Verifikasi Browser">
            {bc ? (
              <>
                <p className="label">Transaction hash</p>
                <code className="hash-box font-mono">{txHash ?? 'Belum dikirim'}</code>
                <div className="mt-2">
                  <CopyButton value={txHash} label="Salin tx hash" what="transaction hash" />
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div>
                    <p>Block {bc.blockNumber?.toLocaleString('id-ID') ?? '—'}</p>
                    <p>{dateTime(bc.confirmedAt)}</p>
                    <p>Chain ID {bc.chainId} · {bc.network}</p>
                    {(p?.contractAddress ?? bc.contractAddress) && (
                      <p className="break-all">Kontrak {p?.contractAddress ?? bc.contractAddress}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      role="status"
                      className={`badge font-normal ${bc.status === 'CONFIRMED' ? 'bg-[#EAF6EF] text-emerald-700' : bc.status === 'FAILED' ? 'bg-[#FFF0EF] text-red-600' : 'bg-[#F1F3F4] text-slate-600'}`}
                    >
                      {bc.status}
                    </span>
                    {explorerUrl && (
                      <a href={explorerUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                        Lihat di Etherscan <ExternalLink size={12} aria-hidden />
                        <span className="sr-only">(tab baru)</span>
                      </a>
                    )}
                  </div>
                </div>
                {bc.lastError && <p className="mt-2 text-xs text-red-600">{bc.lastError}</p>}
              </>
            ) : (
              <p className="text-slate-500">Belum dinotarisasi (donasi belum lunas).</p>
            )}
            {d.canonicalPayload && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={() => setLocal(hashPayload(d.canonicalPayload!))}>
                  <ShieldCheck size={14} aria-hidden /> Hitung ulang hash di browser
                </button>
                {local && (
                  <span role="status" className={`badge ${local === d.hash ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {local === d.hash ? 'Cocok dengan hash DB' : 'Tidak cocok dengan hash DB'}
                  </span>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Tombol ini menghitung ulang hash payload secara lokal di browser dan membandingkannya dengan hash DB. Perbandingan dengan hash on-chain ada di panel di atas.
            </p>
          </Panel>
        </div>

        {d.viewer.isAdmin && (
          <Panel title="Integrity checker (admin)">
            <p className="text-slate-600">Hitung ulang hash dari data database saat ini lalu bandingkan dengan hash di smart contract.</p>
            <button type="button" className="btn-primary btn-sm mt-3" onClick={() => verify.mutate()} disabled={verify.isPending || bc?.status !== 'CONFIRMED'}>
              <ShieldCheck size={14} aria-hidden /> {verify.isPending ? 'Memeriksa…' : 'Verifikasi ke blockchain'}
            </button>
            <div className="mt-3 space-y-3">
              <ErrorBox error={verify.error} />
              {verify.data && <VerifyResultCard r={verify.data} />}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

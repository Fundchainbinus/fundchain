import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DisbursementBadge, ErrorBox, FilterTabs, InfoNote, Panel, Spinner, SuccessBox } from '../components/ui';
import { get } from '../lib/api';
import { date, rupiah } from '../lib/format';
import type { CampaignDetail, Disbursement } from '../lib/types';
import { attachFile, maxSizeLabel, useFilesConfig } from '../lib/upload';

type CampaignRef = { id: string; title: string };

/** Form "Ajukan Pencairan Dana" dengan pilihan kampanye (Pengunjung.png). */
export function DisburseFormCard({ campaigns, initialId }: { campaigns: CampaignRef[]; initialId?: string }) {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState(initialId ?? campaigns[0]?.id ?? '');
  const detail = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => get<CampaignDetail>(`/campaigns/${campaignId}`), enabled: !!campaignId });
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const filesConfig = useFilesConfig();
  const [progress, setProgress] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () =>
      attachFile({
        url: `/campaigns/${campaignId}/disbursements`,
        file: file!,
        purpose: 'disbursement-proof',
        fileField: 'proof',
        fields: { description },
        config: filesConfig,
        onProgress: setProgress,
      }),
    onSettled: () => setProgress(null),
    onSuccess: () => {
      setDescription('');
      setFile(null);
      void qc.invalidateQueries();
    },
  });

  if (!campaigns.length) {
    return <p className="text-[13px] text-slate-500">Belum ada kampanye ACTIVE atau COMPLETED yang dapat dicairkan.</p>;
  }
  const c = detail.data;
  const frozen = c?.status === 'FROZEN';
  const tranche = c?.funds.nextTranche ?? null;
  const blocked = frozen || !tranche || tranche.amount <= 0;
  return (
    <div className="space-y-4">
      {c && (
        <dl className="grid gap-x-6 gap-y-1 text-[13px] text-ink sm:grid-cols-2">
          <div>Terkumpul {rupiah(c.funds.raised)}</div>
          <div>Saldo belum dibayar {rupiah(c.funds.raised - c.funds.disbursed)}</div>
          <div>Sudah dibayar {rupiah(c.funds.disbursed)}</div>
          <div>Termasuk {rupiah(c.funds.approved + c.funds.requested)} dalam pengajuan</div>
        </dl>
      )}
      {frozen && <InfoNote tone="red">Kampanye dibekukan karena integritas data bermasalah. Pencairan terkunci.</InfoNote>}
      {!frozen && tranche && tranche.amount <= 0 && (
        <InfoNote>Belum ada dana untuk tahap {tranche.step}: {tranche.percent}% dana terkumpul sudah dicairkan atau diajukan.</InfoNote>
      )}
      <InfoNote>Dana dicairkan dalam 5 tahap: 20% → 40% → 60% → 80% → 100% dari dana terkumpul. Tahap berikutnya bisa diajukan setelah tahap sebelumnya dibayar atau ditolak.</InfoNote>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="disb-campaign">Kampanye</label>
            <select id="disb-campaign" className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </div>
          <div>
            <p className="label" id="disb-amount-label">Nominal tahap ini</p>
            {c ? (
              tranche ? (
                <>
                  <p className="input bg-slate-50" aria-labelledby="disb-amount-label">{rupiah(tranche.amount)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Tahap {tranche.step} dari 5 · membuka sampai {tranche.percent}% dana terkumpul. Nominal dihitung otomatis.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Kelima tahap pencairan sudah diajukan.</p>
              )
            ) : null}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="disb-desc">Deskripsi penggunaan *</label>
          <input id="disb-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: Pengadaan 50 buku tahap pertama untuk pojok baca." disabled={blocked} />
        </div>
        <div>
          <label className="label" htmlFor="disb-proof">Bukti milestone *</label>
          <input id="disb-proof" type="file" accept=".pdf,.png,.jpg,.jpeg" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={blocked} />
          <p className="mt-1 text-xs text-slate-500">Bukti wajib dilampirkan untuk setiap pengajuan (PDF/PNG/JPG · maksimum {maxSizeLabel(filesConfig.maxBytes)}).</p>
        </div>
        <ErrorBox error={create.error} />
        {create.isSuccess && <SuccessBox>Pengajuan terkirim dan menunggu review admin.</SuccessBox>}
        <button className="btn-primary font-normal" disabled={blocked || create.isPending || !file || description.trim().length < 10}>
          {create.isPending ? `Mengirim…${progress !== null ? ` ${progress}%` : ''}` : tranche ? `Ajukan tahap ${tranche.step} (${tranche.percent}%)` : 'Ajukan pencairan'}
        </button>
      </form>
    </div>
  );
}

/** Tabel "Riwayat Pencairan Saya" untuk satu atau beberapa kampanye. */
export function DisbursementHistory({ campaigns }: { campaigns: CampaignRef[] }) {
  const [tab, setTab] = useState('ALL');
  const results = useQueries({
    queries: campaigns.map((c) => ({
      queryKey: ['campaign-disbursements', c.id],
      queryFn: () => get<Disbursement[]>(`/campaigns/${c.id}/disbursements`),
    })),
  });
  const rows = results
    .flatMap((r, i) => (r.data ?? []).map((d) => ({ ...d, campaign: campaigns[i] })))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const shown = tab === 'ALL' ? rows : rows.filter((d) => d.status === tab);
  const many = campaigns.length > 1;

  return (
    <div className="space-y-4">
      <FilterTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'ALL', label: 'Semua', count: rows.length },
          ...(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const).map((s) => ({
            value: s,
            label: s[0] + s.slice(1).toLowerCase(),
            count: rows.filter((d) => d.status === s).length,
          })),
        ]}
      />
      {results.some((r) => r.isLoading) ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-slate-500">Belum ada pengajuan.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="tbl text-[13px]">
            <thead>
              <tr><th>Pengajuan</th><th>Penggunaan</th><th>Nominal</th><th>Status</th><th>Catatan / aksi</th></tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">{date(d.requestedAt)}</td>
                  <td className="min-w-[180px] [overflow-wrap:anywhere]">
                    {d.description}
                    {many && <p className="text-xs text-slate-500">{d.campaign.title}</p>}
                  </td>
                  <td className="whitespace-nowrap">{rupiah(d.amount)}</td>
                  <td><DisbursementBadge status={d.status} /></td>
                  <td className="min-w-[160px]">
                    {d.status === 'PAID' && `${date(d.paidAt)} · Transfer dicatat admin`}
                    {d.status === 'APPROVED' && 'Menunggu transfer'}
                    {d.status === 'REQUESTED' && 'Menunggu review'}
                    {d.status === 'REJECTED' && `Ditolak: ${d.rejectionReason ?? '-'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DisbursePage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  if (campaign.isLoading) return <Spinner />;
  if (campaign.error) return <ErrorBox error={campaign.error} />;
  const c = campaign.data!;
  if (!c.viewer.isOwner) return <ErrorBox error="Hanya pembuat kampanye yang dapat mengajukan pencairan." />;
  const refs = [{ id: c.id, title: c.title }];

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        <Link to="/my/campaigns" className="text-navy hover:underline">Ruang Mahasiswa</Link> / Ajukan Pencairan Dana
      </p>
      <Panel title="Ajukan Pencairan Dana">
        <DisburseFormCard campaigns={refs} initialId={c.id} />
      </Panel>
      <Panel title="Riwayat Pencairan Saya">
        <DisbursementHistory campaigns={refs} />
      </Panel>
    </div>
  );
}

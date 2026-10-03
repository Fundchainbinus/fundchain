import { FileButton } from '../components/FileButton';
import { LIMITS } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, HandCoins, Pencil, Send, ShieldCheck, Snowflake, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CampaignBadge,
  ChainBadge,
  DisbursementBadge,
  EmptyState,
  ErrorBox,
  ExplorerLink,
  IntegrityBadge,
  ProgressBar,
  ReasonDialog,
  SdgTag,
  Spinner,
  SuccessBox,
} from '../components/ui';
import { get, post } from '../lib/api';
import { date, dateTime, daysLeft, percent, rupiah } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { ActivityItem, CampaignDetail, Disbursement, DonationDetail, PublicDonation } from '../lib/types';

const PRESETS = [25_000, 50_000, 100_000, 250_000];

function DonatePanel({ campaign }: { campaign: CampaignDetail }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [amount, setAmount] = useState(50_000);
  const [anonymous, setAnonymous] = useState(false);
  const donate = useMutation({
    mutationFn: () =>
      post<DonationDetail>(`/campaigns/${campaign.id}/donations`, { amount, anonymous }, { 'Idempotency-Key': crypto.randomUUID() }),
    onSuccess: (d) => navigate(`/donations/${d.id}/pay`),
  });

  if (campaign.status !== 'ACTIVE') {
    return (
      <div className="card p-5 text-sm text-slate-600">
        {campaign.status === 'FROZEN'
          ? 'Campaign dibekukan — tidak menerima donasi dan pencairan dana terkunci.'
          : 'Campaign ini tidak sedang menerima donasi.'}
      </div>
    );
  }
  const valid = Number.isInteger(amount) && amount >= LIMITS.DONATION_MIN && amount <= LIMITS.DONATION_MAX;
  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><HandCoins size={18} className="text-navy" /> Donasi sekarang</h2>
      {!me ? (
        <p className="mt-3 text-sm text-slate-600">Pilih pengguna (mahasiswa) di pojok kanan atas untuk berdonasi.</p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) donate.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${amount === p ? 'border-navy bg-navy-light text-navy' : 'border-slate-200 hover:border-slate-300'}`}
              >
                {rupiah(p)}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="amount">Nominal lain (Rp)</label>
            <input
              id="amount"
              className="input"
              type="number"
              min={LIMITS.DONATION_MIN}
              step={1000}
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            {!valid && <p className="mt-1 text-xs text-red-600">Minimal {rupiah(LIMITS.DONATION_MIN)}.</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Sembunyikan nama saya
          </label>
          <ErrorBox error={donate.error} />
          <button className="btn-primary w-full" disabled={!valid || donate.isPending}>
            {donate.isPending ? 'Membuat pembayaran…' : `Donasi ${rupiah(amount)} via QRIS`}
          </button>
        </form>
      )}
    </div>
  );
}

function AdminPanel({ campaign }: { campaign: CampaignDetail }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | 'reject' | 'freeze' | 'unfreeze'>(null);
  const refresh = () => qc.invalidateQueries();
  const approve = useMutation({ mutationFn: () => post(`/admin/campaigns/${campaign.id}/approve`), onSuccess: refresh });
  const reasonAction = useMutation({
    mutationFn: (reason: string) => post(`/admin/campaigns/${campaign.id}/${dialog}`, { reason }),
    onSuccess: () => {
      setDialog(null);
      void refresh();
    },
  });
  const verify = useMutation({
    mutationFn: () => post<{ checked: number; verified: number; tampered: number }>(`/admin/campaigns/${campaign.id}/verify`),
    onSuccess: refresh,
  });

  return (
    <div className="card border-navy/20 bg-navy-50 p-5">
      <h2 className="font-semibold text-navy">Panel Admin</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {campaign.status === 'PENDING_REVIEW' && (
          <>
            <button className="btn-success btn-sm" onClick={() => approve.mutate()} disabled={approve.isPending}>Setujui</button>
            <button className="btn-danger btn-sm" onClick={() => setDialog('reject')}>Tolak</button>
          </>
        )}
        {['ACTIVE', 'COMPLETED', 'FROZEN'].includes(campaign.status) && (
          <button className="btn-secondary btn-sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
            <ShieldCheck size={14} /> {verify.isPending ? 'Memverifikasi…' : 'Cek integritas semua donasi'}
          </button>
        )}
        {['ACTIVE', 'COMPLETED'].includes(campaign.status) && (
          <button className="btn-secondary btn-sm" onClick={() => setDialog('freeze')}><Snowflake size={14} /> Bekukan</button>
        )}
        {campaign.status === 'FROZEN' && (
          <button className="btn-secondary btn-sm" onClick={() => setDialog('unfreeze')}><Sun size={14} /> Cabut pembekuan</button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        <ErrorBox error={approve.error ?? verify.error} />
        {verify.data && (
          verify.data.tampered > 0 ? (
            <ErrorBox error={`${verify.data.tampered} donasi TAMPERED dari ${verify.data.checked} yang dicek. Campaign dibekukan.`} />
          ) : (
            <SuccessBox>{verify.data.verified} dari {verify.data.checked} donasi terverifikasi cocok dengan blockchain.</SuccessBox>
          )
        )}
      </div>
      {dialog && (
        <ReasonDialog
          open
          title={{ reject: 'Tolak campaign', freeze: 'Bekukan campaign', unfreeze: 'Cabut pembekuan' }[dialog]}
          confirmLabel={{ reject: 'Tolak', freeze: 'Bekukan', unfreeze: 'Cabut pembekuan' }[dialog]}
          danger={dialog !== 'unfreeze'}
          pending={reasonAction.isPending}
          error={reasonAction.error}
          onCancel={() => setDialog(null)}
          onConfirm={(r) => reasonAction.mutate(r)}
        />
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CAMPAIGN_CREATED: 'Campaign dibuat',
  CAMPAIGN_UPDATED: 'Campaign diperbarui',
  CAMPAIGN_PROPOSAL_UPLOADED: 'Proposal diunggah',
  CAMPAIGN_SUBMITTED: 'Diajukan untuk review',
  CAMPAIGN_RESUBMITTED: 'Diajukan ulang setelah revisi',
  CAMPAIGN_APPROVED: 'Disetujui admin',
  CAMPAIGN_REJECTED: 'Ditolak admin',
  CAMPAIGN_FROZEN: 'Dibekukan',
  CAMPAIGN_UNFROZEN: 'Pembekuan dicabut',
  CAMPAIGN_COMPLETED: 'Campaign selesai',
  DISBURSEMENT_REQUESTED: 'Pencairan diajukan',
  DISBURSEMENT_APPROVED: 'Pencairan disetujui',
  DISBURSEMENT_REJECTED: 'Pencairan ditolak',
  DISBURSEMENT_PAID: 'Dana dicairkan',
};

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  const donations = useQuery({ queryKey: ['campaign-donations', id], queryFn: () => get<PublicDonation[]>(`/campaigns/${id}/donations`), refetchInterval: 5000 });
  const disbursements = useQuery({ queryKey: ['campaign-disbursements', id], queryFn: () => get<Disbursement[]>(`/campaigns/${id}/disbursements`) });
  const activity = useQuery({ queryKey: ['campaign-activity', id], queryFn: () => get<ActivityItem[]>(`/campaigns/${id}/activity`) });
  const qc = useQueryClient();
  const submit = useMutation({ mutationFn: () => post(`/campaigns/${id}/submit`), onSuccess: () => qc.invalidateQueries() });

  if (campaign.isLoading) return <Spinner />;
  if (campaign.error) return <ErrorBox error={campaign.error} />;
  const c = campaign.data!;
  const left = daysLeft(c.deadline);
  const canEdit = c.viewer.isOwner && ['DRAFT', 'REJECTED'].includes(c.status);

  return (
    <div className="space-y-6">
      {c.status === 'FROZEN' && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-800" role="alert">
          <Snowflake className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Campaign dibekukan — pencairan dana terkunci</p>
            <p className="mt-1 text-sm">{c.frozenReason ?? 'Integritas data donasi bermasalah.'}</p>
          </div>
        </div>
      )}
      {c.status === 'REJECTED' && c.viewer.isOwner && (
        <ErrorBox error={`Ditolak admin: ${c.rejectionReason}. Silakan revisi lalu ajukan ulang.`} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-2">
              <SdgTag code={c.sdgCategory} />
              <CampaignBadge status={c.status} />
            </div>
            <h1 className="mt-3 text-2xl font-bold">{c.title}</h1>
            <p className="mt-1 text-sm text-slate-500">oleh {c.creator.name} · dibuat {date(c.createdAt)}</p>
            <p className="mt-5 whitespace-pre-line text-slate-700">{c.description}</p>
            {c.documents.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {c.documents.slice(0, 1).map((d) => (
                  <FileButton key={d.id} linkPath={`/documents/${d.id}/link`}>
                    Lihat proposal ({Math.ceil(d.size / 1024)} KB)
                  </FileButton>
                ))}
              </div>
            )}
            {c.viewer.isOwner && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
                {canEdit && (
                  <>
                    <Link to={`/campaigns/${c.id}/edit`} className="btn-secondary btn-sm"><Pencil size={14} /> Edit & unggah proposal</Link>
                    <button className="btn-primary btn-sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
                      <Send size={14} /> Ajukan untuk review
                    </button>
                  </>
                )}
                {['ACTIVE', 'COMPLETED'].includes(c.status) && (
                  <Link to={`/campaigns/${c.id}/disburse`} className="btn-primary btn-sm"><HandCoins size={14} /> Ajukan pencairan dana</Link>
                )}
                <div className="w-full"><ErrorBox error={submit.error} /></div>
              </div>
            )}
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Donasi & bukti blockchain</h2>
              <span className="text-xs text-slate-500">{c.donorCount} donasi lunas</span>
            </div>
            {donations.data && donations.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Donatur</th>
                      <th className="px-3 py-2 font-medium">Nominal</th>
                      <th className="px-3 py-2 font-medium">Blockchain</th>
                      <th className="px-3 py-2 font-medium">Integritas</th>
                      <th className="px-5 py-2 font-medium"><span className="sr-only">Bukti</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {donations.data.map((d) => (
                      <tr key={d.id} className={d.integrityStatus === 'TAMPERED' ? 'bg-red-50' : ''}>
                        <td className="px-5 py-3">
                          <p className="font-medium">{d.donorName}</p>
                          <p className="text-xs text-slate-500">{dateTime(d.donatedAt)}</p>
                        </td>
                        <td className="px-3 py-3 font-medium">{rupiah(d.amount)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1"><ChainBadge status={d.blockchainStatus} /><ExplorerLink url={d.explorerUrl} txHash={d.txHash} /></div>
                        </td>
                        <td className="px-3 py-3"><IntegrityBadge status={d.integrityStatus} /></td>
                        <td className="whitespace-nowrap px-5 py-3 text-right"><Link to={`/donations/${d.id}`} className="text-xs font-medium text-navy hover:underline">Bukti →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Belum ada donasi.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Pencairan dana</h2>
            {disbursements.data && disbursements.data.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {disbursements.data.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{rupiah(d.amount)} — {d.description}</p>
                      <p className="text-xs text-slate-500">
                        Diajukan {date(d.requestedAt)}{d.reviewedBy ? ` · ditinjau ${d.reviewedBy}` : ''}{d.rejectionReason ? ` · alasan: ${d.rejectionReason}` : ''}
                      </p>
                    </div>
                    <DisbursementBadge status={d.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Belum ada pengajuan pencairan.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-2xl font-bold text-slate-900">{rupiah(c.currentAmount)}</p>
            <p className="text-sm text-slate-500">terkumpul dari target {rupiah(c.targetAmount)}</p>
            <div className="mt-3"><ProgressBar current={c.currentAmount} target={c.targetAmount} /></div>
            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <span>{percent(c.currentAmount, c.targetAmount)}% · {c.donorCount} donatur</span>
              <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {left > 0 ? `${left} hari lagi` : `Berakhir ${date(c.deadline)}`}</span>
            </div>
            <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <div className="flex justify-between"><dt>Sudah dicairkan</dt><dd>{rupiah(c.funds.disbursed)}</dd></div>
              <div className="flex justify-between"><dt>Disetujui / diajukan</dt><dd>{rupiah(c.funds.approved + c.funds.requested)}</dd></div>
              <div className="flex justify-between font-medium text-slate-800"><dt>Sisa dapat dicairkan</dt><dd>{rupiah(c.funds.available)}</dd></div>
            </dl>
            {(c.integritySummary.VERIFIED || c.integritySummary.TAMPERED) && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {!!c.integritySummary.VERIFIED && <span className="badge bg-emerald-100 text-emerald-800">{c.integritySummary.VERIFIED} terverifikasi</span>}
                {!!c.integritySummary.TAMPERED && <span className="badge bg-red-100 text-red-700">{c.integritySummary.TAMPERED} tampered</span>}
              </div>
            )}
          </div>
          <DonatePanel campaign={c} />
          {c.viewer.isAdmin && <AdminPanel campaign={c} />}
          {c.reviews.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold">Riwayat review</h2>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {c.reviews.map((r) => (
                  <li key={r.id}>
                    <b className={r.decision === 'APPROVE' ? 'text-emerald-700' : 'text-red-700'}>{r.decision === 'APPROVE' ? 'Disetujui' : 'Ditolak'}</b> oleh {r.admin.name} · {dateTime(r.createdAt)}
                    {r.reason && <p className="mt-0.5 italic">“{r.reason}”</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card p-5">
            <h2 className="text-sm font-semibold">Jejak aktivitas</h2>
            {activity.data?.length ? (
              <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">
                {activity.data.map((a) => (
                  <li key={a.id} className="relative text-xs">
                    <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${a.action === 'CAMPAIGN_FROZEN' ? 'bg-red-500' : 'bg-navy'}`} />
                    <p className="font-medium text-slate-800">{ACTION_LABEL[a.action] ?? a.action}</p>
                    <p className="text-slate-500">{a.actor.name} · {dateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="Belum ada aktivitas" />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

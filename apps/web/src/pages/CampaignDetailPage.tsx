import { FileButton } from '../components/FileButton';
import { LIMITS } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CreditCard, ExternalLink, HandCoins, Pencil, Send, ShieldCheck, Snowflake, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CampaignBadge,
  ChainBadge,
  DisbursementBadge,
  ErrorBox,
  ExplorerLink,
  FilterTabs,
  InfoNote,
  IntegrityBadge,
  Panel,
  ProgressBar,
  ReasonDialog,
  Spinner,
  SuccessBox,
} from '../components/ui';
import { get, post } from '../lib/api';
import { date, dateTime, daysLeft, fileSize, percent, rupiah, sdg } from '../lib/format';
import { useConfig, useMe } from '../lib/hooks';
import type { ActivityItem, CampaignDetail, Disbursement, DonationDetail, PublicDonation } from '../lib/types';

const PRESETS = [50_000, 100_000, 250_000];

function DonatePanel({ campaign }: { campaign: CampaignDetail }) {
  const { me } = useMe();
  const config = useConfig();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(50_000);
  const [anonymous, setAnonymous] = useState(false);
  const provider = config.data?.paymentProvider ?? '';
  const canSimulate = !!config.data?.devTools && provider === 'mock';
  const providerLabel = provider === 'mock' ? 'Mock payment · mode demo' : provider ? `${provider[0].toUpperCase()}${provider.slice(1)} · QRIS` : 'QRIS';
  const create = () =>
    post<DonationDetail>(`/campaigns/${campaign.id}/donations`, { amount, anonymous }, { 'Idempotency-Key': crypto.randomUUID() });
  // Checkout: buat donasi lalu buka halaman pembayaran (QRIS / gateway).
  const checkout = useMutation({ mutationFn: create, onSuccess: (d) => navigate(`/donations/${d.id}/pay`) });
  // Mode demo: buat donasi lalu langsung kirim webhook simulasi "settlement".
  const simulate = useMutation({
    mutationFn: async () => {
      const d = await create();
      await post(`/dev/payments/${d.id}/simulate`, { outcome: 'settlement' });
      return d;
    },
    onSuccess: (d) => {
      void qc.invalidateQueries();
      navigate(`/donations/${d.id}`);
    },
  });
  const busy = checkout.isPending || simulate.isPending;
  const valid = Number.isInteger(amount) && amount >= LIMITS.DONATION_MIN && amount <= LIMITS.DONATION_MAX;
  // Tombol "Donasi" di kartu kampanye menautkan ke #donasi.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#donasi') document.getElementById('donasi')?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  return (
    <Panel title="Donasi ke Kampanye">
      <div id="donasi" className="scroll-mt-28 space-y-4">
        <p className="text-[17px] font-medium text-ink [overflow-wrap:anywhere]">{campaign.title}</p>
        <InfoNote tone={campaign.status === 'FROZEN' ? 'red' : 'blue'}>
          {campaign.status === 'FROZEN'
            ? 'Kampanye dibekukan: tidak menerima donasi dan pencairan dana terkunci.'
            : 'Hanya kampanye ACTIVE yang dapat menerima donasi.'}
        </InfoNote>
        {campaign.status === 'ACTIVE' && !me && <p className="text-[13px] text-slate-600">Login dulu (pojok kanan atas) untuk berdonasi.</p>}
        {campaign.status === 'ACTIVE' && me && (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="amount">Nominal donasi (IDR)</label>
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
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={`rounded border px-3 py-2 text-[13px] ${amount === p ? 'border-navy bg-navy text-white' : 'border-line text-ink hover:bg-slate-50'}`}
                >
                  {rupiah(p)}{amount === p && ' ✓'}
                </button>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="method">Metode pembayaran</label>
              <select id="method" className="input" value={provider} disabled>
                <option value={provider}>{providerLabel}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-slate-600">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Sembunyikan nama saya
            </label>
            <ErrorBox error={checkout.error ?? simulate.error} />
            <div className="flex flex-col items-start gap-3">
              {canSimulate && (
                <button className="btn-primary font-normal" disabled={!valid || busy} onClick={() => simulate.mutate()}>
                  <CreditCard size={15} /> {simulate.isPending ? 'Memproses…' : 'Simulasikan pembayaran berhasil'}
                </button>
              )}
              <button className={canSimulate ? 'btn-secondary font-normal' : 'btn-primary font-normal'} disabled={!valid || busy} onClick={() => checkout.mutate()}>
                {checkout.isPending ? 'Membuat pembayaran…' : `Checkout via ${provider === 'mock' || !provider ? 'QRIS' : provider[0].toUpperCase() + provider.slice(1)}`}
                <ExternalLink size={13} />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Setelah lunas, donasi tercatat di Donasi Saya: PAID. Dana diproses di luar blockchain; hash bukti dinotarisasikan setelah pembayaran.
            </p>
          </div>
        )}
      </div>
    </Panel>
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
    <div className="card border-navy/30 bg-navy-50 p-4">
      <h2 className="text-sm font-semibold text-navy-dark">Panel Admin</h2>
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

type DetailTab = 'proposal' | 'dana' | 'riwayat';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  const donations = useQuery({ queryKey: ['campaign-donations', id], queryFn: () => get<PublicDonation[]>(`/campaigns/${id}/donations`), refetchInterval: 5000 });
  const disbursements = useQuery({ queryKey: ['campaign-disbursements', id], queryFn: () => get<Disbursement[]>(`/campaigns/${id}/disbursements`) });
  const activity = useQuery({ queryKey: ['campaign-activity', id], queryFn: () => get<ActivityItem[]>(`/campaigns/${id}/activity`) });
  const qc = useQueryClient();
  const submit = useMutation({ mutationFn: () => post(`/campaigns/${id}/submit`), onSuccess: () => qc.invalidateQueries() });
  const [tab, setTab] = useState<DetailTab>('proposal');

  if (campaign.isLoading) return <Spinner />;
  if (campaign.error) return <ErrorBox error={campaign.error} />;
  const c = campaign.data!;
  const left = daysLeft(c.deadline);
  const s = sdg(c.sdgCategory);
  const canEdit = c.viewer.isOwner && ['DRAFT', 'REJECTED'].includes(c.status);
  const doc = c.documents[0];
  const funds: [string, number][] = [
    ['Terkumpul', c.funds.raised],
    ['Sudah dicairkan', c.funds.disbursed],
    ['Disetujui / diajukan', c.funds.approved + c.funds.requested],
    ['Sisa dapat dicairkan', c.funds.available],
  ];

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        <Link to="/" className="text-navy hover:underline">Jelajahi Kampanye</Link> / Detail Kampanye
      </p>
      {c.status === 'FROZEN' && (
        <div className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-red-800" role="alert">
          <Snowflake className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Kampanye dibekukan · pencairan dana terkunci</p>
            <p className="mt-1 text-sm">{c.frozenReason ?? 'Integritas data donasi bermasalah.'}</p>
          </div>
        </div>
      )}
      {c.status === 'REJECTED' && c.viewer.isOwner && (
        <InfoNote tone="amber">Ditolak admin: {c.rejectionReason}. Perbaiki proposal lalu ajukan ulang.</InfoNote>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Detail Kampanye">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-[22px] font-medium [overflow-wrap:anywhere]">{c.title}</h1>
              <CampaignBadge status={c.status} />
            </div>
            <p className="mt-3 text-[13px] text-slate-500 [overflow-wrap:anywhere]">
              {c.creator.name} · {s ? `SDG ${s.number}` : c.sdgCategory} · Target {rupiah(c.targetAmount)} · Batas waktu {date(c.deadline)}
            </p>
            <div className="mt-4">
              <FilterTabs
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'proposal', label: 'Proposal & Dokumen' },
                  { value: 'dana', label: 'Milestone & Dana' },
                  { value: 'riwayat', label: 'Riwayat' },
                ]}
              />
            </div>

            {tab === 'proposal' && (
              <div className="mt-4 space-y-4">
                <p className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{c.description}</p>
                {doc ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#F7F7F7] px-3 py-3">
                    <span className="text-[13px] text-ink [overflow-wrap:anywhere]">
                      {doc.originalName} · {fileSize(doc.size)} · PDF
                    </span>
                    <FileButton linkPath={`/documents/${doc.id}/link`}>Lihat proposal</FileButton>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Belum ada proposal.</p>
                )}
                {disbursements.data && disbursements.data.length > 0 && (
                  <div className="overflow-x-auto rounded border border-line">
                    <table className="tbl text-[13px]">
                      <thead>
                        <tr><th>Milestone / penggunaan dana</th><th>Anggaran</th><th>Progres</th></tr>
                      </thead>
                      <tbody>
                        {disbursements.data.map((d) => (
                          <tr key={d.id}>
                            <td className="[overflow-wrap:anywhere]">{d.description}</td>
                            <td className="whitespace-nowrap">{rupiah(d.amount)}</td>
                            <td><DisbursementBadge status={d.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!activity.data?.length && (
                  <ul className="grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
                    {activity.data.slice(-4).map((a) => (
                      <li key={a.id}>{date(a.createdAt)} · {ACTION_LABEL[a.action] ?? a.action}</li>
                    ))}
                  </ul>
                )}
                {c.viewer.isOwner && (
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    {canEdit && (
                      <>
                        <Link to={`/campaigns/${c.id}/edit`} className="btn-secondary btn-sm"><Pencil size={14} /> Edit & unggah proposal</Link>
                        <button className="btn-primary btn-sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
                          <Send size={14} /> {c.status === 'REJECTED' ? 'Ajukan ulang' : 'Kirim untuk review admin'}
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
            )}

            {tab === 'dana' && (
              <div className="mt-4 space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  {funds.map(([l, v]) => (
                    <div key={l} className="rounded-md bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">{l}</dt>
                      <dd className="font-semibold text-ink">{rupiah(v)}</dd>
                    </div>
                  ))}
                </dl>
                {disbursements.data && disbursements.data.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="tbl">
                      <thead>
                        <tr><th>Milestone / penggunaan dana</th><th>Nominal</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {disbursements.data.map((d) => (
                          <tr key={d.id}>
                            <td className="min-w-[200px]">
                              <p className="[overflow-wrap:anywhere]">{d.description}</p>
                              <p className="text-xs text-slate-500">
                                Diajukan {date(d.requestedAt)}{d.reviewedBy ? ` · ditinjau ${d.reviewedBy}` : ''}{d.rejectionReason ? ` · alasan: ${d.rejectionReason}` : ''}
                              </p>
                            </td>
                            <td className="whitespace-nowrap">{rupiah(d.amount)}</td>
                            <td><DisbursementBadge status={d.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Belum ada pengajuan pencairan.</p>
                )}
              </div>
            )}

            {tab === 'riwayat' && (
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-ink">Jejak aktivitas</p>
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
                    <p className="mt-2 text-sm text-slate-500">Belum ada aktivitas.</p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Riwayat review</p>
                  {c.reviews.length ? (
                    <ul className="mt-2 space-y-2 text-xs text-slate-600">
                      {c.reviews.map((r) => (
                        <li key={r.id}>
                          <b className={r.decision === 'APPROVE' ? 'text-emerald-700' : 'text-red-700'}>{r.decision === 'APPROVE' ? 'Disetujui' : 'Ditolak'}</b> oleh {r.admin.name} · {dateTime(r.createdAt)}
                          {r.reason && <p className="mt-0.5 italic">“{r.reason}”</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Belum ada review.</p>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Donasi & bukti blockchain" aside={<span className="text-xs text-slate-500">{c.donorCount} donasi lunas</span>}>
            {donations.data && donations.data.length > 0 ? (
              <div className="-m-4 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th>Donatur</th><th>Nominal</th><th>Blockchain</th><th>Integritas</th><th><span className="sr-only">Bukti</span></th></tr>
                  </thead>
                  <tbody>
                    {donations.data.map((d) => (
                      <tr key={d.id} className={d.integrityStatus === 'TAMPERED' ? 'bg-red-50' : ''}>
                        <td>
                          <p className="font-medium">{d.donorName}</p>
                          <p className="text-xs text-slate-500">{dateTime(d.donatedAt)}</p>
                        </td>
                        <td className="whitespace-nowrap font-medium">{rupiah(d.amount)}</td>
                        <td>
                          <div className="flex flex-col gap-1"><ChainBadge status={d.blockchainStatus} /><ExplorerLink url={d.explorerUrl} txHash={d.txHash} /></div>
                        </td>
                        <td><IntegrityBadge status={d.integrityStatus} /></td>
                        <td className="whitespace-nowrap text-right"><Link to={`/donations/${d.id}`} className="text-xs font-medium text-navy hover:underline">Bukti →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-500">Belum ada donasi.</p>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <div className="card p-4">
            <p className="text-2xl font-bold text-ink">{rupiah(c.currentAmount)}</p>
            <p className="text-sm text-slate-500">terkumpul dari target {rupiah(c.targetAmount)}</p>
            <div className="mt-3"><ProgressBar current={c.currentAmount} target={c.targetAmount} danger={c.status === 'FROZEN'} /></div>
            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <span>{percent(c.currentAmount, c.targetAmount)}% · {c.donorCount} donatur</span>
              <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {left > 0 ? `${left} hari lagi` : `Berakhir ${date(c.deadline)}`}</span>
            </div>
            {(c.integritySummary.VERIFIED || c.integritySummary.TAMPERED) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {!!c.integritySummary.VERIFIED && <span className="badge bg-emerald-50 text-emerald-700">{c.integritySummary.VERIFIED} terverifikasi</span>}
                {!!c.integritySummary.TAMPERED && <span className="badge bg-red-50 text-red-600">{c.integritySummary.TAMPERED} tampered</span>}
              </div>
            )}
          </div>
          <DonatePanel campaign={c} />
          {c.viewer.isAdmin && <AdminPanel campaign={c} />}
        </aside>
      </div>
    </div>
  );
}

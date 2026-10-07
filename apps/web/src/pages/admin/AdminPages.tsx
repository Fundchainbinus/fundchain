import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Glasses, LayoutDashboard, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { FileButton } from '../../components/FileButton';
import { RoleCard } from '../../components/RoleCard';
import {
  CampaignBadge,
  ChainBadge,
  DisbursementBadge,
  EmptyState,
  ErrorBox,
  FilterTabs,
  InfoNote,
  IntegrityBadge,
  PageHeader,
  Spinner,
  Stat,
  SuccessBox,
} from '../../components/ui';
import { errorMessage, get, openProtectedFile, post } from '../../lib/api';
import { date, dateTime, fileSize, rupiah, sdg, shortHash } from '../../lib/format';
import { useMe } from '../../lib/hooks';
import type { AdminDisbursement, AuditLog, CampaignDetail, CampaignSummary, ChainInfo, VerifyResult } from '../../lib/types';

const count = <T,>(rows: T[], pred: (r: T) => boolean) => rows.filter(pred).length;

export function AdminLayout() {
  const { me } = useMe();
  const menu = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/reviews', label: 'Review Campaign', icon: Glasses },
    { to: '/admin/integrity', label: 'Integritas', icon: Glasses },
    { to: '/admin/disbursements', label: 'Pencairan', icon: Glasses },
    { to: '/admin/audit', label: 'Audit Log', icon: Glasses },
  ];
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="shrink-0 bg-navy text-white md:w-[232px]">
        {/* CHANGE berpindah ke tampilan mahasiswa/pengunjung. */}
        <RoleCard role="Admin" name={me?.name} changeTo="/" className="m-3 hidden md:flex" />
        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-0 md:p-0 md:pt-1" aria-label="Menu admin">
          {menu.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-l-full px-4 py-2.5 text-[17px] font-bold transition md:ml-0.5 ${
                  isActive ? 'bg-navy-deep text-white' : 'text-white hover:bg-white/10'
                }`
              }
            >
              <m.icon size={20} aria-hidden fill={m.icon === LayoutDashboard ? 'currentColor' : 'none'} /> {m.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex-1 px-4 py-6">
          <Outlet />
        </div>
        <footer className="bg-footer px-4 py-5 text-[13px] text-white">Copyright © BINUS University. All rights reserved.</footer>
      </div>
    </div>
  );
}

function ChainCard({ chain, onRefresh, refreshing }: { chain?: ChainInfo; onRefresh?: () => void; refreshing?: boolean }) {
  if (!chain) return null;
  return (
    <div className={chain.ready ? '' : 'rounded-lg border border-red-200 bg-red-50 p-4'}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xl text-ink">{chain.network}</p>
        <span className={`badge ${chain.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {chain.ready ? 'Connected' : 'Offline'}
        </span>
      </div>
      <p className="mt-3 text-xs text-ink">Chain ID: {chain.chainId} · DonationRegistry</p>
      <div className="mt-3 grid gap-3">
        <div>
          <p className="label">Contract address</p>
          <code className="hash-box">{chain.contractAddress ?? '—'}</code>
        </div>
        <div>
          <p className="label">Relayer address</p>
          <code className="hash-box">{chain.relayer?.address ?? '—'}</code>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-600">Saldo relayer</p>
          <p className={`mt-2 text-[22px] ${chain.relayer?.lowBalance ? 'text-red-700' : 'text-ink'}`}>
            {chain.relayer?.balance ? `${Number(chain.relayer.balance).toLocaleString('id-ID', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ETH` : '—'}
            {chain.relayer?.lowBalance && <span className="ml-2 text-xs font-medium">rendah, isi dari faucet</span>}
          </p>
        </div>
      </div>
      {!chain.ready && <p className="mt-3 text-sm text-red-700">{chain.reason}. Notarisasi ditunda dan dilanjutkan otomatis.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {onRefresh && (
          <button className="btn-secondary btn-sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
        {chain.explorerUrl && (
          <a className="btn-secondary btn-sm" href={chain.explorerUrl} target="_blank" rel="noreferrer">
            Buka contract <ExternalLink size={12} />
          </a>
        )}
      </div>
      <p className="mt-3 text-[11px] font-semibold text-slate-600">Relayer membayar gas untuk mencatat hash. Dana donasi tidak disimpan di DonationRegistry.</p>
    </div>
  );
}

interface Stats {
  campaigns: Record<string, number>;
  donations: Record<string, number>;
  totalRaised: number;
  blockchain: Record<string, number>;
  integrity: Record<string, number>;
  disbursements: Record<string, { count: number; amount: number }>;
  chain: ChainInfo;
}

export function AdminDashboardPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => get<Stats>('/admin/stats'), refetchInterval: 10_000 });
  if (stats.isLoading) return <Spinner />;
  if (stats.error) return <ErrorBox error={stats.error} />;
  const s = stats.data!;
  const n = (r: Record<string, number>, k: string) => r[k] ?? 0;
  const pendingChain = n(s.blockchain, 'QUEUED') + n(s.blockchain, 'SUBMITTED') + n(s.blockchain, 'RETRYING');
  const req = s.disbursements.REQUESTED;
  const appr = s.disbursements.APPROVED;
  const paidDonations = n(s.integrity, 'VERIFIED') + n(s.integrity, 'TAMPERED') + n(s.integrity, 'PENDING');
  return (
    <div className="space-y-5">
      <h1 className="mb-5 text-[28px] font-normal text-ink">Administrasi FundChain</h1>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Review kampanye"
          value={`${n(s.campaigns, 'PENDING_REVIEW')} menunggu`}
          hint={<Link to="/admin/reviews" className="text-navy hover:underline">Buka antrean →</Link>}
        />
        <Stat
          label="Pencairan"
          value={rupiah((req?.amount ?? 0) + (appr?.amount ?? 0))}
          hint={`${req?.count ?? 0} Requested · ${appr?.count ?? 0} Approved`}
        />
        <Stat
          label="Integritas bermasalah"
          value={`${n(s.integrity, 'TAMPERED')} Tampered`}
          hint={`${n(s.campaigns, 'FROZEN')} campaign Frozen`}
        />
        <Stat
          label="Notarisasi gagal"
          value={`${n(s.blockchain, 'FAILED')} Failed`}
          hint={n(s.blockchain, 'FAILED') ? 'perlu retry di halaman Integritas' : 'tidak ada'}
        />
        <Stat
          label="Campaign aktif"
          value={`${n(s.campaigns, 'ACTIVE')} aktif`}
          hint={`${n(s.campaigns, 'COMPLETED')} Completed · ${n(s.campaigns, 'FROZEN')} Frozen`}
        />
        <Stat label="Dana terkumpul" value={rupiah(s.totalRaised)} hint={`Dari ${n(s.donations, 'PAID')} donasi`} />
        <Stat
          label="Integritas donasi"
          value={`${n(s.integrity, 'VERIFIED')} / ${paidDonations} Verified`}
          hint={`${n(s.integrity, 'TAMPERED')} Tampered · ${n(s.integrity, 'PENDING')} Pending`}
        />
        <Stat
          label="Notarisasi"
          value={`${n(s.blockchain, 'CONFIRMED')} On-Chain`}
          hint={`${pendingChain} Dalam Progress · ${n(s.blockchain, 'FAILED')} Gagal`}
        />
      </div>
      <h2 className="pt-2 text-[28px] font-normal text-ink">Monitoring Blockchain</h2>
      <ChainCard chain={s.chain} onRefresh={() => void stats.refetch()} refreshing={stats.isFetching} />
    </div>
  );
}

type ReviewTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FROZEN';
const REVIEW_GROUPS: Record<ReviewTab, string[]> = {
  PENDING: ['PENDING_REVIEW'],
  APPROVED: ['ACTIVE', 'COMPLETED'],
  REJECTED: ['REJECTED'],
  FROZEN: ['FROZEN'],
};

/** Nama & ukuran proposal; detail kampanye di-cache sehingga dipakai ulang oleh panel review. */
function ProposalCell({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  const doc = detail.data?.documents[0];
  if (detail.isLoading) return <span className="text-slate-400">…</span>;
  if (!doc) return <span className="text-slate-400">Belum ada</span>;
  return (
    <>
      <p className="[overflow-wrap:anywhere]">{doc.originalName}</p>
      <p className="text-slate-500">{fileSize(doc.size)}</p>
    </>
  );
}

function ReviewPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  const [reason, setReason] = useState('');
  const done = () => {
    setReason('');
    void qc.invalidateQueries();
  };
  const approve = useMutation({ mutationFn: () => post(`/admin/campaigns/${id}/approve`), onSuccess: done });
  const reject = useMutation({ mutationFn: () => post(`/admin/campaigns/${id}/reject`, { reason: reason.trim() }), onSuccess: done });

  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const c = detail.data!;
  const s = sdg(c.sdgCategory);
  const pending = c.status === 'PENDING_REVIEW';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">Review · {c.title}</p>
        {c.documents[0] && (
          <FileButton linkPath={`/documents/${c.documents[0].id}/link`}>Periksa proposal PDF</FileButton>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {c.creator.name} · {s ? `SDG ${s.number} · ${s.label}` : c.sdgCategory} · target {rupiah(c.targetAmount)} · deadline {date(c.deadline)}
      </p>
      <p className="whitespace-pre-line text-xs text-ink [overflow-wrap:anywhere]">{c.description}</p>
      {!c.documents.length && <InfoNote tone="amber">Proposal belum diunggah.</InfoNote>}
      {pending ? (
        <>
          <div>
            <label className="label" htmlFor="review-reason">Alasan penolakan *</label>
            <input
              id="review-reason"
              className="input"
              placeholder="Contoh: Rincian penerima bantuan belum dilampirkan."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">Wajib diisi (min. 10 karakter) saat menolak; alasan terlihat oleh pembuat kampanye.</p>
          </div>
          <ErrorBox error={approve.error ?? reject.error} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={() => approve.mutate()} disabled={approve.isPending || reject.isPending}>
              <CheckCircle2 size={14} /> Setujui kampanye
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => reject.mutate()}
              disabled={reason.trim().length < 10 || approve.isPending || reject.isPending}
            >
              Tolak dengan alasan
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CampaignBadge status={c.status} />
          {c.rejectionReason && <span className="text-xs text-slate-600">Alasan: {c.rejectionReason}</span>}
          {c.frozenReason && <span className="text-xs text-slate-600">Alasan: {c.frozenReason}</span>}
          <Link to={`/campaigns/${c.id}`} className="btn-secondary btn-sm ml-auto">Buka halaman kampanye</Link>
        </div>
      )}
    </div>
  );
}

export function AdminReviewsPage() {
  const [tab, setTab] = useState<ReviewTab>('PENDING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'campaigns', 'ALL'],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/admin/campaigns', { status: 'ALL', limit: 100 }),
  });
  const all = q.data?.campaigns ?? [];
  const list = all.filter((c) => REVIEW_GROUPS[tab].includes(c.status));
  const selected = list.find((c) => c.id === selectedId) ?? list[0];
  const tabs = (Object.keys(REVIEW_GROUPS) as ReviewTab[]).map((k) => ({
    value: k,
    label: { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', FROZEN: 'Frozen' }[k],
    count: count(all, (c) => REVIEW_GROUPS[k].includes(c.status)),
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="Review Kampanye FundChain" />
      <FilterTabs items={tabs} value={tab} onChange={(v) => { setTab(v); setSelectedId(null); }} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : list.length === 0 ? (
        <EmptyState title="Antrean kosong">Tidak ada kampanye di tab ini.</EmptyState>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kampanye / pembuat</th>
                  <th>Target / deadline</th>
                  <th>Proposal</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const s = sdg(c.sdgCategory);
                  return (
                    <tr key={c.id} className={selected?.id === c.id ? 'bg-navy-50' : ''}>
                      <td className="min-w-[220px]">
                        <p className="text-ink [overflow-wrap:anywhere]">{c.title}</p>
                        <p className="text-xs text-slate-500">{c.creator.name}{s ? ` · SDG ${s.number}` : ''}</p>
                      </td>
                      <td className="whitespace-nowrap">
                        <p>{rupiah(c.targetAmount)}</p>
                        <p className="text-xs text-slate-500">{date(c.deadline)}</p>
                      </td>
                      <td><ProposalCell id={c.id} /></td>
                      <td>
                        <button className="text-xs text-ink hover:text-navy hover:underline" onClick={() => setSelectedId(c.id)}>
                          {tab === 'PENDING' ? 'Review' : 'Detail'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected && <ReviewPanel key={selected.id} id={selected.id} />}
        </>
      )}
    </div>
  );
}

interface AdminDonation {
  id: string;
  amount: number;
  donor: { name: string; integritySubjectId: string };
  campaign: { id: string; title: string; status: string };
  donatedAt: string;
  hash: string;
  integrityStatus: 'PENDING' | 'VERIFIED' | 'TAMPERED';
  lastCheckedAt: string | null;
  blockchain: { status: 'QUEUED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'RETRYING'; txHash: string | null; retryCount: number; lastError: string | null; explorerUrl: string | null } | null;
}

export function AdminIntegrityPage() {
  const qc = useQueryClient();
  const [integrity, setIntegrity] = useState('');
  const [chainFilter, setChainFilter] = useState('');
  const donations = useQuery({
    queryKey: ['admin', 'donations'],
    queryFn: () => get<AdminDonation[]>('/admin/donations'),
    refetchInterval: 5000,
  });
  const [last, setLast] = useState<VerifyResult | null>(null);
  const verifyOne = useMutation({
    mutationFn: (id: string) => post<VerifyResult>(`/admin/donations/${id}/verify`),
    onSuccess: (r) => {
      setLast(r);
      void qc.invalidateQueries();
    },
  });
  const verifyAll = useMutation({
    mutationFn: () => post<{ checked: number; verified: number; tampered: number; skippedNotNotarized: number; frozenCampaigns: string[] }>('/admin/integrity/verify-all'),
    onSuccess: () => qc.invalidateQueries(),
  });
  const retry = useMutation({ mutationFn: (id: string) => post(`/admin/blockchain/${id}/retry`), onSuccess: () => qc.invalidateQueries() });

  const all = donations.data ?? [];
  const byIntegrity = all.filter((d) => !integrity || d.integrityStatus === integrity);
  const rows = byIntegrity.filter((d) => !chainFilter || d.blockchain?.status === chainFilter);
  const lastRow = last && all.find((d) => d.id === last.donationId);

  return (
    <div className="space-y-4">
      <PageHeader title="Pemeriksa Integritas & Antrean Notarisasi" />
      <div className="flex flex-wrap items-center justify-between gap-2">
      <FilterTabs
        value={integrity}
        onChange={setIntegrity}
        items={[
          { value: '', label: 'Semua', count: all.length },
          { value: 'VERIFIED', label: 'Verified', count: count(all, (d) => d.integrityStatus === 'VERIFIED') },
          { value: 'TAMPERED', label: 'Tampered', count: count(all, (d) => d.integrityStatus === 'TAMPERED') },
          { value: 'PENDING', label: 'Pending', count: count(all, (d) => d.integrityStatus === 'PENDING') },
        ]}
      />
        <button className="btn-primary btn-sm" onClick={() => verifyAll.mutate()} disabled={verifyAll.isPending}>
          <ShieldCheck size={14} /> {verifyAll.isPending ? 'Memeriksa…' : 'Verifikasi semua'}
        </button>
      </div>
      <FilterTabs
        size="sm"
        value={chainFilter}
        onChange={setChainFilter}
        items={[
          { value: '', label: 'Semua status chain' },
          ...(['QUEUED', 'SUBMITTED', 'CONFIRMED', 'RETRYING', 'FAILED'] as const).map((s) => ({
            value: s,
            label: s[0] + s.slice(1).toLowerCase(),
            count: count(byIntegrity, (d) => d.blockchain?.status === s),
            tone: s === 'CONFIRMED' ? ('green' as const) : s === 'FAILED' ? ('red' as const) : undefined,
          })),
        ]}
      />

      <ErrorBox error={verifyAll.error ?? verifyOne.error ?? retry.error} />
      {verifyAll.data && (
        verifyAll.data.tampered > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span><b>{verifyAll.data.tampered} donasi TAMPERED</b> dari {verifyAll.data.checked} yang dicek. {verifyAll.data.frozenCampaigns.length} kampanye otomatis dibekukan dan pencairannya dikunci.</span>
          </div>
        ) : (
          <SuccessBox>Semua {verifyAll.data.checked} donasi cocok dengan blockchain.{verifyAll.data.skippedNotNotarized ? ` ${verifyAll.data.skippedNotNotarized} belum ternotarisasi (dilewati).` : ''}</SuccessBox>
        )
      )}

      {donations.isLoading ? <Spinner /> : donations.error ? <ErrorBox error={donations.error} /> : rows.length === 0 ? (
        <EmptyState title="Tidak ada donasi" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Donasi / kampanye</th>
                <th>DB hash</th>
                <th>Tx on-chain</th>
                <th>Integritas</th>
                <th>Chain / aksi</th>
                <th>Verifikasi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className={d.integrityStatus === 'TAMPERED' ? 'bg-red-50' : ''}>
                  <td className="min-w-[200px]">
                    <Link to={`/donations/${d.id}`} className="text-ink hover:text-navy [overflow-wrap:anywhere]">{d.campaign.title}</Link>
                    <p>{rupiah(d.amount)} · {d.donor.name}</p>
                  </td>
                  <td className="whitespace-nowrap" title={d.hash}>{shortHash(d.hash)}</td>
                  <td>
                    {d.blockchain?.txHash ? (
                      d.blockchain.explorerUrl ? (
                        <a href={d.blockchain.explorerUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap hover:text-navy" title={d.blockchain.txHash}>
                          {shortHash(d.blockchain.txHash)}
                        </a>
                      ) : (
                        <span className="whitespace-nowrap" title={d.blockchain.txHash}>{shortHash(d.blockchain.txHash)}</span>
                      )
                    ) : (
                      'Belum tercatat'
                    )}
                  </td>
                  <td><IntegrityBadge status={d.integrityStatus} /></td>
                  <td>
                    <ChainBadge status={d.blockchain?.status} />
                    {d.blockchain?.lastError && d.blockchain.status !== 'CONFIRMED' && (
                      <p className="mt-1 max-w-[180px] truncate text-xs text-red-600" title={d.blockchain.lastError}>{d.blockchain.lastError}</p>
                    )}
                  </td>
                  <td>
                    {d.blockchain?.status === 'FAILED' ? (
                      <button className="btn-secondary btn-sm" onClick={() => retry.mutate(d.id)} disabled={retry.isPending}>
                        <RefreshCw size={12} /> Ulangi
                      </button>
                    ) : (
                      <button
                        className="btn-primary btn-sm"
                        disabled={d.blockchain?.status !== 'CONFIRMED' || verifyOne.isPending}
                        onClick={() => verifyOne.mutate(d.id)}
                      >
                        <ShieldCheck size={12} /> Verifikasi
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {last && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">
            Perbandingan terpilih · {lastRow ? lastRow.campaign.title : shortHash(last.donationId)}
          </p>
          <div className="space-y-1 font-mono text-xs">
            <p className="break-all"><span className="inline-block w-16 text-slate-500">DB</span>
              <span className={last.status === 'TAMPERED' ? 'text-red-600' : 'text-slate-700'}>{last.currentHash}</span>
            </p>
            <p className="break-all"><span className="inline-block w-16 text-slate-500">On-chain</span>{last.onChainHash}</p>
          </div>
          {last.status === 'TAMPERED' ? (
            <InfoNote tone="red">
              Hash tidak cocok: donasi ditandai TAMPERED{last.campaignFrozen ? ' dan kampanyenya dibekukan otomatis (pencairan dikunci)' : ''}.
            </InfoNote>
          ) : (
            <SuccessBox>Hash DB sama dengan hash on-chain.</SuccessBox>
          )}
        </div>
      )}

      <details className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
        <summary className="flex cursor-pointer items-center gap-2 font-medium"><Terminal size={14} /> Simulasi manipulasi data (demo)</summary>
        <p className="mt-2">Jalankan di terminal project, lalu klik Verifikasi:</p>
        <code className="mono mt-1 block rounded bg-slate-900 px-3 py-2 text-emerald-300">pnpm demo:tamper --latest 900000</code>
      </details>
    </div>
  );
}

export function AdminDisbursementsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [proofError, setProofError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'disbursements'], queryFn: () => get<AdminDisbursement[]>('/admin/disbursements') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'mark-paid' }) =>
      post(`/admin/disbursements/${id}/${action}`, action === 'reject' ? { reason: reason.trim() } : undefined),
    onSuccess: () => {
      setReason('');
      void qc.invalidateQueries();
    },
  });
  const all = q.data ?? [];
  const list = all.filter((d) => d.status === status);
  const selected = list.find((d) => d.id === selectedId) ?? list[0];
  const openProof = (id: string) => {
    setProofError(null);
    openProtectedFile(`/disbursements/${id}/proof`).catch((e) => setProofError(errorMessage(e)));
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Review Pencairan & Transfer" />
      <FilterTabs
        value={status}
        onChange={(v) => { setStatus(v); setSelectedId(null); setReason(''); }}
        items={(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const).map((s) => ({
          value: s,
          label: s[0] + s.slice(1).toLowerCase(),
          count: count(all, (d) => d.status === s),
        }))}
      />
      <ErrorBox error={act.error ?? proofError} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : list.length === 0 ? (
        <EmptyState title="Tidak ada pengajuan" />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pengajuan / pembuat</th>
                  <th>Nominal</th>
                  <th>Penggunaan / bukti</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className={selected?.id === d.id ? 'bg-navy-50' : ''}>
                    <td className="min-w-[180px]">
                      <p>{d.requester.name}</p>
                      <Link to={`/campaigns/${d.campaign.id}`} className="hover:text-navy [overflow-wrap:anywhere]">{d.campaign.title}</Link>
                      {d.campaign.status === 'FROZEN' && <span className="ml-1"><CampaignBadge status="FROZEN" /></span>}
                    </td>
                    <td className="whitespace-nowrap">{rupiah(d.amount)}</td>
                    <td className="min-w-[200px]">
                      <p className="[overflow-wrap:anywhere]">{d.description}</p>
                      <p>{d.proofName}</p>
                    </td>
                    <td><DisbursementBadge status={d.status} /></td>
                    <td className="whitespace-nowrap">
                      <button className="hover:text-navy hover:underline" onClick={() => openProof(d.id)}>Periksa bukti</button>
                      {(d.status === 'REQUESTED' || d.status === 'APPROVED') && (
                        <>
                          {' · '}
                          <button className="hover:text-navy hover:underline" onClick={() => setSelectedId(d.id)}>
                            {d.status === 'REQUESTED' ? 'Review' : 'Tandai paid'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (selected.status === 'REQUESTED' || selected.status === 'APPROVED') && (
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {rupiah(selected.amount)} · {selected.campaign.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Diajukan {selected.requester.name} · {dateTime(selected.requestedAt)} · saldo kampanye {rupiah(selected.campaign.currentAmount)}
                </p>
                {selected.status === 'REQUESTED' && (
                  <div className="mt-3">
                    <label className="label" htmlFor="disb-reason">Alasan penolakan *</label>
                    <input
              id="disb-reason"
              className="input"
                      placeholder="Contoh: Bukti milestone belum menunjukkan jumlah buku yang dibeli."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-500">Wajib untuk penolakan (min. 10 karakter). Kampanye Frozen tidak dapat dicairkan.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-stretch">
                <button className="btn-secondary btn-sm" onClick={() => openProof(selected.id)}>
                  <FileText size={12} /> Lihat bukti milestone
                </button>
                {selected.status === 'REQUESTED' ? (
                  <div className="flex gap-2">
                    <button className="btn-primary btn-sm flex-1" disabled={act.isPending} onClick={() => act.mutate({ id: selected.id, action: 'approve' })}>
                      Setujui
                    </button>
                    <button
                      className="btn-secondary btn-sm flex-1"
                      disabled={act.isPending || reason.trim().length < 10}
                      onClick={() => act.mutate({ id: selected.id, action: 'reject' })}
                    >
                      Tolak
                    </button>
                  </div>
                ) : (
                  <button className="btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: selected.id, action: 'mark-paid' })}>
                    Tandai transfer dibayar
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 md:col-span-2">
                Mark paid mencatat transfer dana di luar blockchain. Riwayat mahasiswa menampilkan Requested → Approved → Paid, atau Rejected beserta alasannya.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ACTION_FILTERS = [
  ['', 'Semua aksi'],
  ['CAMPAIGN', 'Kampanye'],
  ['DONATION', 'Donasi'],
  ['PAYMENT', 'Pembayaran'],
  ['BLOCKCHAIN', 'Notarisasi / blockchain'],
  ['INTEGRITY', 'Integritas'],
  ['DISBURSEMENT', 'Pencairan'],
];

/** Ringkas metadata audit jadi "kunci: nilai · …" agar mudah dibaca. */
function metaSummary(meta: Record<string, unknown>) {
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export function AdminAuditPage() {
  const [draft, setDraft] = useState({ action: '', entityType: '' });
  const [filter, setFilter] = useState(draft);
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit', filter.action, filter.entityType],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<{ logs: AuditLog[]; nextCursor: string | null }>('/admin/audit-logs', {
        action: filter.action || undefined,
        entityType: filter.entityType || undefined,
        cursor: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const logs = q.data?.pages.flatMap((p) => p.logs) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" />
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(draft);
        }}
      >
        <div>
          <label className="label" htmlFor="f-action">Filter aksi</label>
          <select id="f-action" className="input sm:w-56" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-entity">Filter entitas</label>
          <select id="f-entity" className="input sm:w-48" value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
            <option value="">Semua entitas</option>
            <option value="Campaign">Campaign</option>
            <option value="Donation">Donasi</option>
            <option value="Payment">Payment</option>
            <option value="System">Sistem</option>
          </select>
        </div>
        <button className="btn-secondary whitespace-nowrap">Terapkan filter</button>
        {!q.isLoading && <span className="text-xs text-slate-500 sm:pb-2.5">Menampilkan {logs.length} catatan{q.hasNextPage ? ' (masih ada lagi)' : ''}</span>}
      </form>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : logs.length === 0 ? (
        <EmptyState title="Belum ada catatan" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Aksi</th>
                <th>Aktor</th>
                <th>Entitas</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{dateTime(l.createdAt)}</td>
                  <td className="whitespace-nowrap">{l.action}</td>
                  <td className="whitespace-nowrap">{l.actor ? l.actor.name : 'Sistem'}</td>
                  <td className="whitespace-nowrap">
                    {l.entityType}
                    {l.entityId && (
                      <Link
                        className="ml-1 hover:text-navy hover:underline"
                        to={l.entityType === 'Campaign' ? `/campaigns/${l.entityId}` : l.entityType === 'Donation' ? `/donations/${l.entityId}` : '#'}
                      >
                        {l.entityId.slice(0, 8)}
                      </Link>
                    )}
                  </td>
                  <td className="min-w-[220px] [overflow-wrap:anywhere]">{metaSummary(l.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 p-3 text-xs text-slate-500">
            <span>Jejak aktivitas review, donasi, notarisasi, integritas, dan pencairan.</span>
            {q.hasNextPage && (
              <button className="btn-secondary btn-sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Muat lebih banyak</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

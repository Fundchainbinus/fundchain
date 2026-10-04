import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileSearch, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  CampaignBadge,
  ChainBadge,
  DisbursementBadge,
  EmptyState,
  ErrorBox,
  ExplorerLink,
  HashText,
  IntegrityBadge,
  PageHeader,
  ReasonDialog,
  Spinner,
  Stat,
  SuccessBox,
} from '../../components/ui';
import { errorMessage, get, openProtectedFile, post } from '../../lib/api';
import { date, dateTime, rupiah } from '../../lib/format';
import { useChainInfo } from '../../lib/hooks';
import type { AdminDisbursement, AuditLog, CampaignSummary, ChainInfo, VerifyResult } from '../../lib/types';

export function AdminLayout() {
  const tabs = [
    { to: '/admin', label: 'Ringkasan', end: true },
    { to: '/admin/reviews', label: 'Review campaign' },
    { to: '/admin/integrity', label: 'Integritas' },
    { to: '/admin/disbursements', label: 'Pencairan' },
    { to: '/admin/audit', label: 'Audit log' },
  ];
  return (
    <div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Menu admin">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${isActive ? 'border-navy text-navy' : 'border-transparent text-slate-500 hover:text-slate-800'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

function ChainCard({ chain }: { chain?: ChainInfo }) {
  if (!chain) return null;
  return (
    <div className={`card p-5 ${chain.ready ? '' : 'border-red-200 bg-red-50'}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <span className={`h-2.5 w-2.5 rounded-full ${chain.ready ? 'bg-emerald-500' : 'bg-red-500'}`} /> Blockchain
      </h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Jaringan</dt><dd>{chain.network} (chain ID {chain.chainId})</dd></div>
        <div>
          <dt className="text-xs text-slate-500">Contract DonationRegistry</dt>
          <dd>{chain.explorerUrl ? <a className="mono text-navy hover:underline" href={chain.explorerUrl} target="_blank" rel="noreferrer">{chain.contractAddress}</a> : <HashText value={chain.contractAddress} />}</dd>
        </div>
        <div><dt className="text-xs text-slate-500">Relayer wallet</dt><dd><HashText value={chain.relayer?.address} label="alamat relayer" /></dd></div>
        <div>
          <dt className="text-xs text-slate-500">Saldo relayer</dt>
          <dd className={chain.relayer?.lowBalance ? 'font-semibold text-red-700' : ''}>
            {chain.relayer?.balance ? `${Number(chain.relayer.balance).toFixed(4)} ETH` : '—'}
            {chain.relayer?.lowBalance && ' (rendah! isi dari faucet)'}
          </dd>
        </div>
      </dl>
      {!chain.ready && <p className="mt-3 text-sm text-red-700">{chain.reason}. Notarisasi ditunda dan akan dilanjutkan otomatis.</p>}
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
  const pendingChain = (s.blockchain.QUEUED ?? 0) + (s.blockchain.SUBMITTED ?? 0) + (s.blockchain.RETRYING ?? 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard admin" subtitle="Ringkasan operasional FundChain." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Menunggu review" value={s.campaigns.PENDING_REVIEW ?? 0} hint={<Link to="/admin/reviews" className="text-navy hover:underline">Buka antrean →</Link>} />
        <Stat label="Total donasi lunas" value={rupiah(s.totalRaised)} hint={`${s.donations.PAID ?? 0} transaksi`} />
        <Stat label="Notarisasi" value={`${s.blockchain.CONFIRMED ?? 0} on-chain`} hint={`${pendingChain} dalam proses · ${s.blockchain.FAILED ?? 0} gagal`} danger={(s.blockchain.FAILED ?? 0) > 0} />
        <Stat
          label="Integritas"
          value={s.integrity.TAMPERED ? `${s.integrity.TAMPERED} TAMPERED` : `${s.integrity.VERIFIED ?? 0} terverifikasi`}
          hint={`${s.campaigns.FROZEN ?? 0} campaign dibekukan`}
          danger={(s.integrity.TAMPERED ?? 0) > 0}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Campaign aktif" value={s.campaigns.ACTIVE ?? 0} />
        <Stat label="Pencairan diajukan" value={s.disbursements.REQUESTED?.count ?? 0} hint={rupiah(s.disbursements.REQUESTED?.amount)} />
        <Stat label="Pencairan disetujui" value={s.disbursements.APPROVED?.count ?? 0} hint={rupiah(s.disbursements.APPROVED?.amount)} />
        <Stat label="Sudah dicairkan" value={rupiah(s.disbursements.PAID?.amount)} />
      </div>
      <ChainCard chain={s.chain} />
    </div>
  );
}

export function AdminReviewsPage() {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const q = useQuery({ queryKey: ['admin', 'campaigns', status], queryFn: () => get<{ campaigns: CampaignSummary[] }>('/admin/campaigns', { status, limit: 100 }) });
  const filters = [['PENDING_REVIEW', 'Menunggu review'], ['ACTIVE', 'Aktif'], ['REJECTED', 'Ditolak'], ['FROZEN', 'Dibekukan'], ['ALL', 'Semua']];
  return (
    <div>
      <PageHeader title="Review campaign" subtitle="Periksa proposal lalu setujui atau tolak dengan alasan." />
      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map(([v, l]) => (
          <button key={v} className={status === v ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data!.campaigns.length === 0 ? (
        <EmptyState title="Antrean kosong">Tidak ada campaign dengan status ini.</EmptyState>
      ) : (
        <div className="card divide-y divide-slate-100">
          {q.data!.campaigns.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.title}</p>
                <p className="text-xs text-slate-500">{c.creator.name} · target {rupiah(c.targetAmount)} · deadline {date(c.deadline)} · dibuat {date(c.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <CampaignBadge status={c.status} />
                <Link to={`/campaigns/${c.id}`} className="btn-secondary btn-sm"><FileSearch size={14} /> Review</Link>
              </div>
            </div>
          ))}
        </div>
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
  const chain = useChainInfo();
  const [filter, setFilter] = useState('');
  const donations = useQuery({
    queryKey: ['admin', 'donations', filter],
    queryFn: () => get<AdminDonation[]>('/admin/donations', { integrityStatus: filter || undefined }),
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrity checker"
        subtitle="Hash dihitung ulang dari data database saat ini lalu dibandingkan dengan hash di smart contract."
        actions={
          <button className="btn-primary" onClick={() => verifyAll.mutate()} disabled={verifyAll.isPending}>
            <ShieldCheck size={16} /> {verifyAll.isPending ? 'Memeriksa…' : 'Verifikasi semua donasi'}
          </button>
        }
      />
      <ChainCard chain={chain.data} />

      <div className="space-y-3">
        <ErrorBox error={verifyAll.error ?? verifyOne.error ?? retry.error} />
        {verifyAll.data && (
          verifyAll.data.tampered > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <AlertTriangle size={18} className="shrink-0" />
              <span><b>{verifyAll.data.tampered} donasi TAMPERED</b> dari {verifyAll.data.checked} yang dicek. {verifyAll.data.frozenCampaigns.length} campaign otomatis dibekukan dan pencairannya dikunci.</span>
            </div>
          ) : (
            <SuccessBox>Semua {verifyAll.data.checked} donasi cocok dengan blockchain.{verifyAll.data.skippedNotNotarized ? ` ${verifyAll.data.skippedNotNotarized} belum ternotarisasi (dilewati).` : ''}</SuccessBox>
          )
        )}
        {last && (
          <div className={`rounded-lg border p-4 text-sm ${last.status === 'VERIFIED' ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <div className="flex items-center gap-2"><IntegrityBadge status={last.status} /> <span className="text-xs text-slate-500">donasi {last.donationId.slice(0, 8)}</span></div>
            <p className="mono mt-2 break-all">DB      : {last.currentHash}</p>
            <p className="mono break-all">On-chain: {last.onChainHash}</p>
            {last.campaignFrozen && <p className="mt-2 font-semibold text-red-800">Campaign dibekukan otomatis.</p>}
          </div>
        )}
      </div>

      <div className="card flex items-start gap-3 border-dashed bg-slate-50 p-4 text-sm text-slate-700">
        <Terminal size={18} className="mt-0.5 shrink-0 text-slate-500" />
        <div>
          <b>Simulasi manipulasi data (demo)</b> — jalankan di terminal project, lalu klik verifikasi:
          <code className="mono mt-1 block rounded bg-slate-900 px-3 py-2 text-emerald-300">pnpm demo:tamper --latest 900000</code>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['', 'Semua'], ['VERIFIED', 'Terverifikasi'], ['TAMPERED', 'Tampered'], ['PENDING', 'Belum dicek']].map(([v, l]) => (
          <button key={v} className={filter === v ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {donations.isLoading ? <Spinner /> : donations.data?.length === 0 ? <EmptyState title="Tidak ada donasi" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Donasi</th>
                <th className="px-3 py-3 font-medium">Nominal (DB)</th>
                <th className="px-3 py-3 font-medium">Hash</th>
                <th className="px-3 py-3 font-medium">Blockchain</th>
                <th className="px-3 py-3 font-medium">Integritas</th>
                <th className="px-4 py-3"><span className="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {donations.data?.map((d) => (
                <tr key={d.id} className={d.integrityStatus === 'TAMPERED' ? 'bg-red-50' : ''}>
                  <td className="px-4 py-3">
                    <Link to={`/donations/${d.id}`} className="font-medium hover:text-navy">{d.campaign.title}</Link>
                    <p className="text-xs text-slate-500">{d.donor.name} ({d.donor.integritySubjectId}) · {dateTime(d.donatedAt)}</p>
                  </td>
                  <td className="px-3 py-3 font-medium">{rupiah(d.amount)}</td>
                  <td className="px-3 py-3"><HashText value={d.hash} /></td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <ChainBadge status={d.blockchain?.status} />
                      <ExplorerLink url={d.blockchain?.explorerUrl ?? null} txHash={d.blockchain?.txHash ?? null} />
                      {d.blockchain?.lastError && d.blockchain.status !== 'CONFIRMED' && <span className="max-w-[200px] truncate text-xs text-red-600" title={d.blockchain.lastError}>{d.blockchain.lastError}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3"><IntegrityBadge status={d.integrityStatus} /><p className="mt-1 text-xs text-slate-500">{d.lastCheckedAt ? dateTime(d.lastCheckedAt) : ''}</p></td>
                  <td className="px-4 py-3 text-right">
                    {d.blockchain?.status === 'FAILED' ? (
                      <button className="btn-secondary btn-sm" onClick={() => retry.mutate(d.id)}><RefreshCw size={12} /> Ulangi</button>
                    ) : (
                      <button className="btn-secondary btn-sm" disabled={d.blockchain?.status !== 'CONFIRMED' || verifyOne.isPending} onClick={() => verifyOne.mutate(d.id)}>
                        Verifikasi
                      </button>
                    )}
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

export function AdminDisbursementsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'disbursements', status], queryFn: () => get<AdminDisbursement[]>('/admin/disbursements', { status: status || undefined }) });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject' | 'mark-paid'; reason?: string }) =>
      post(`/admin/disbursements/${id}/${action}`, reason ? { reason } : undefined),
    onSuccess: () => {
      setRejecting(null);
      void qc.invalidateQueries();
    },
  });
  const [proofError, setProofError] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Pencairan dana" subtitle="Setujui hanya jika bukti milestone valid. Campaign FROZEN otomatis terkunci." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[['REQUESTED', 'Diajukan'], ['APPROVED', 'Disetujui'], ['PAID', 'Dicairkan'], ['REJECTED', 'Ditolak'], ['', 'Semua']].map(([v, l]) => (
          <button key={v} className={status === v ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      <div className="mb-4 space-y-2"><ErrorBox error={act.error ?? proofError} /></div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data!.length === 0 ? (
        <EmptyState title="Tidak ada pengajuan" />
      ) : (
        <div className="space-y-3">
          {q.data!.map((d) => (
            <div key={d.id} className={`card p-4 ${d.campaign.status === 'FROZEN' ? 'border-red-200' : ''}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold">{rupiah(d.amount)}</p>
                    <DisbursementBadge status={d.status} />
                    {d.campaign.status === 'FROZEN' && <CampaignBadge status="FROZEN" />}
                  </div>
                  <Link to={`/campaigns/${d.campaign.id}`} className="text-sm font-medium text-navy hover:underline">{d.campaign.title}</Link>
                  <p className="mt-1 text-sm text-slate-700">{d.description}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    oleh {d.requester.name} · {dateTime(d.requestedAt)} · saldo campaign {rupiah(d.campaign.currentAmount)}
                    {d.rejectionReason && ` · alasan tolak: ${d.rejectionReason}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setProofError(null);
                      openProtectedFile(`/disbursements/${d.id}/proof`).catch((e) => setProofError(errorMessage(e)));
                    }}
                  >
                    Lihat bukti
                  </button>
                  {d.status === 'REQUESTED' && (
                    <>
                      <button className="btn-success btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: 'approve' })}>Setujui</button>
                      <button className="btn-danger btn-sm" onClick={() => setRejecting(d.id)}>Tolak</button>
                    </>
                  )}
                  {d.status === 'APPROVED' && (
                    <button className="btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: 'mark-paid' })}>Tandai sudah ditransfer</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {rejecting && (
        <ReasonDialog
          open
          title="Tolak pengajuan pencairan"
          confirmLabel="Tolak"
          danger
          pending={act.isPending}
          error={act.error}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => act.mutate({ id: rejecting, action: 'reject', reason })}
        />
      )}
    </div>
  );
}

export function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit', action, entityType],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<{ logs: AuditLog[]; nextCursor: string | null }>('/admin/audit-logs', { action: action || undefined, entityType: entityType || undefined, cursor: pageParam, limit: 50 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const logs = q.data?.pages.flatMap((p) => p.logs) ?? [];
  const danger = (a: string) => /TAMPERED|FROZEN|MISMATCH|REJECTED|FAILED/.test(a);

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Semua keputusan dan event kritis tercatat di sini." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input className="input sm:w-64" placeholder="Filter aksi, mis. INTEGRITY" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} aria-label="Filter aksi" />
        <select className="input sm:w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Filter entitas">
          <option value="">Semua entitas</option>
          <option value="Campaign">Campaign</option>
          <option value="Donation">Donasi</option>
          <option value="Payment">Payment</option>
          <option value="System">Sistem</option>
        </select>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Waktu</th>
                <th className="px-3 py-3 font-medium">Aksi</th>
                <th className="px-3 py-3 font-medium">Aktor</th>
                <th className="px-3 py-3 font-medium">Entitas</th>
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{dateTime(l.createdAt)}</td>
                  <td className="px-3 py-2.5"><span className={`mono font-medium ${danger(l.action) ? 'text-red-700' : 'text-slate-800'}`}>{l.action}</span></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">{l.actor ? `${l.actor.name}` : <span className="text-slate-400">Sistem</span>}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {l.entityType}
                    {l.entityId && (
                      <Link className="ml-1 font-mono text-navy hover:underline" to={l.entityType === 'Campaign' ? `/campaigns/${l.entityId}` : l.entityType === 'Donation' ? `/donations/${l.entityId}` : '#'}>
                        {l.entityId.slice(0, 8)}
                      </Link>
                    )}
                  </td>
                  <td className="max-w-md px-4 py-2.5"><code className="mono break-all text-slate-600">{Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : ''}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.hasNextPage && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button className="btn-secondary btn-sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Muat lebih banyak</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

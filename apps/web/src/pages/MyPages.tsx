import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CampaignBadge, ChainBadge, Chips, DonationBadge, EmptyState, ErrorBox, IntegrityBadge, PageHeader, Spinner } from '../components/ui';
import { get } from '../lib/api';
import { dateTime, rupiah } from '../lib/format';
import type { CampaignSummary, MyDonation } from '../lib/types';

const MY_TABS = [
  { value: 'ALL', label: 'Semua' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FROZEN', label: 'Frozen' },
  { value: 'COMPLETED', label: 'Completed' },
] as const;

export function MyCampaignsPage() {
  const [tab, setTab] = useState<(typeof MY_TABS)[number]['value']>('ALL');
  const q = useQuery({ queryKey: ['campaigns', 'mine'], queryFn: () => get<{ campaigns: CampaignSummary[] }>('/campaigns', { mine: 'true', limit: 100 }) });
  const list = q.data?.campaigns ?? [];
  const shown = tab === 'ALL' ? list : list.filter((c) => c.status === tab);
  return (
    <div>
      <PageHeader
        title="Kampanye Saya"
        subtitle="Kelola kampanye, proposal, dan penggunaan dana Anda — termasuk draft dan yang menunggu review."
        actions={<Link to="/campaigns/new" className="btn-primary"><Plus size={16} /> Buat kampanye</Link>}
      />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : list.length === 0 ? (
        <EmptyState title="Belum punya kampanye">Mulai galang dana untuk proyek sosial Anda.</EmptyState>
      ) : (
        <div className="card p-4">
          <Chips
            value={tab}
            onChange={setTab}
            options={MY_TABS.map((t) => ({ ...t, count: t.value === 'ALL' ? list.length : list.filter((c) => c.status === t.value).length }))}
          />
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Kampanye</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{c.title}</p>
                      <p className="text-xs text-slate-500">
                        {c.status === 'DRAFT' || c.status === 'PENDING_REVIEW' || c.status === 'REJECTED'
                          ? `Target ${rupiah(c.targetAmount)}`
                          : `${rupiah(c.currentAmount)} / ${rupiah(c.targetAmount)}`}
                      </p>
                      {c.status === 'REJECTED' && c.rejectionReason && (
                        <p className="mt-1 text-xs text-red-700">Ditolak: {c.rejectionReason}</p>
                      )}
                      {c.status === 'FROZEN' && c.frozenReason && (
                        <p className="mt-1 text-xs text-red-700">{c.frozenReason}</p>
                      )}
                    </td>
                    <td className="px-3 py-3"><CampaignBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-xs">
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link to={`/campaigns/${c.id}`} className="font-medium text-brand hover:underline">Detail</Link>
                        {(c.status === 'DRAFT' || c.status === 'REJECTED') && (
                          <Link to={`/campaigns/${c.id}/edit`} className="font-medium text-brand hover:underline">
                            {c.status === 'DRAFT' ? 'Edit draft' : 'Revisi'}
                          </Link>
                        )}
                        {(c.status === 'ACTIVE' || c.status === 'COMPLETED') && (
                          <Link to={`/campaigns/${c.id}/disburse`} className="font-medium text-brand hover:underline">Ajukan pencairan</Link>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function MyDonationsPage() {
  const q = useQuery({ queryKey: ['me', 'donations'], queryFn: () => get<MyDonation[]>('/me/donations') });
  return (
    <div>
      <PageHeader title="Donasi Saya" subtitle="Riwayat donasi beserta status pencatatan blockchain." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data!.length === 0 ? (
        <EmptyState title="Belum ada donasi"><Link to="/" className="text-brand underline">Jelajahi campaign</Link></EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-3 py-3 font-medium">Nominal</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Blockchain</th>
                <th className="px-3 py-3 font-medium">Integritas</th>
                <th className="px-5 py-3"><span className="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data!.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-3">
                    <Link to={`/campaigns/${d.campaign.id}`} className="font-medium hover:text-brand">{d.campaign.title}</Link>
                    <p className="text-xs text-slate-500">{dateTime(d.createdAt)}</p>
                  </td>
                  <td className="px-3 py-3 font-medium">{rupiah(d.amount)}</td>
                  <td className="px-3 py-3"><DonationBadge status={d.status} /></td>
                  <td className="px-3 py-3"><ChainBadge status={d.blockchainStatus} /></td>
                  <td className="px-3 py-3">{d.status === 'PAID' ? <IntegrityBadge status={d.integrityStatus} /> : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <Link to={d.status === 'PENDING' ? `/donations/${d.id}/pay` : `/donations/${d.id}`} className="text-xs font-medium text-brand hover:underline">
                      {d.status === 'PENDING' ? 'Bayar →' : 'Bukti →'}
                    </Link>
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

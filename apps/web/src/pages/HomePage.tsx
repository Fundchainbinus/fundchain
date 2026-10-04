import { SDG_CATEGORIES } from '@fundchain/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CampaignCard } from '../components/CampaignCard';
import { Chips, EmptyState, ErrorBox, Spinner, Stat } from '../components/ui';
import { get } from '../lib/api';
import { rupiah } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { CampaignSummary, MyDonation } from '../lib/types';

const PUBLIC_STATUSES = 'ACTIVE,COMPLETED,FROZEN';
type StatusTab = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'FROZEN';

/** Ringkasan di atas daftar kampanye, dihitung dari data publik (dan donasi persona aktif). */
function Summary() {
  const { me } = useMe();
  const all = useQuery({
    queryKey: ['campaigns', 'summary'],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/campaigns', { status: PUBLIC_STATUSES, limit: 100 }),
  });
  const mine = useQuery({
    queryKey: ['me', 'donations'],
    queryFn: () => get<MyDonation[]>('/me/donations'),
    enabled: !!me,
  });
  const list = all.data?.campaigns ?? [];
  const count = (s: string) => list.filter((c) => c.status === s).length;
  const paid = mine.data?.filter((d) => d.status === 'PAID') ?? [];
  const verified = paid.filter((d) => d.integrityStatus === 'VERIFIED').length;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Dana terkumpul"
        value={rupiah(list.reduce((n, c) => n + c.currentAmount, 0))}
        hint={`Dari ${list.reduce((n, c) => n + c.donorCount, 0)} donasi berhasil`}
      />
      <Stat
        label="Kampanye publik"
        value={`${list.length} kampanye`}
        hint={`${count('ACTIVE')} Active · ${count('COMPLETED')} Completed · ${count('FROZEN')} Frozen`}
      />
      <Stat
        label={me ? `Donasi saya · ${me.name}` : 'Donasi saya'}
        value={me ? rupiah(paid.reduce((n, d) => n + d.amount, 0)) : '—'}
        hint={me ? `${paid.length} pembayaran berhasil` : 'Pilih persona untuk melihat'}
      />
      <Stat
        label="Integritas donasi saya"
        value={me ? `${verified} / ${paid.length} Verified` : '—'}
        hint={me ? `${paid.filter((d) => d.integrityStatus === 'TAMPERED').length} Tampered · ${paid.filter((d) => d.integrityStatus === 'PENDING').length} Pending` : 'Dicek terhadap hash on-chain'}
        danger={paid.some((d) => d.integrityStatus === 'TAMPERED')}
      />
    </div>
  );
}

export function HomePage() {
  const [q, setQ] = useState('');
  const [sdg, setSdg] = useState('');
  const [status, setStatus] = useState<StatusTab>('ALL');
  const campaigns = useQuery({
    queryKey: ['campaigns', { q, sdg }],
    queryFn: () =>
      get<{ campaigns: CampaignSummary[] }>('/campaigns', { q: q || undefined, sdg: sdg || undefined, status: PUBLIC_STATUSES, limit: 100 }),
  });
  const list = campaigns.data?.campaigns ?? [];
  const shown = status === 'ALL' ? list : list.filter((c) => c.status === status);
  const count = (s: StatusTab) => (s === 'ALL' ? list.length : list.filter((c) => c.status === s).length);

  return (
    <div className="space-y-5">
      <Summary />

      <section>
        <h2 className="section-title mb-3">Jelajahi Kampanye</h2>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="q">Cari kampanye</label>
            <div className="relative">
              <input id="q" className="input pr-9" placeholder="Cari judul atau nama pembuat…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            </div>
          </div>
          <div className="lg:w-64">
            <label className="label" htmlFor="sdg">Kategori SDG</label>
            <select id="sdg" className="input" value={sdg} onChange={(e) => setSdg(e.target.value)}>
              <option value="">Semua kategori SDG</option>
              {SDG_CATEGORIES.map((s) => (
                <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>
              ))}
            </select>
          </div>
          <Chips<StatusTab>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'ALL', label: 'Semua', count: count('ALL') },
              { value: 'ACTIVE', label: 'Active', count: count('ACTIVE') },
              { value: 'COMPLETED', label: 'Completed', count: count('COMPLETED') },
              { value: 'FROZEN', label: 'Frozen', count: count('FROZEN') },
            ]}
          />
        </div>

        {campaigns.isLoading ? (
          <Spinner />
        ) : campaigns.error ? (
          <ErrorBox error={campaigns.error} />
        ) : shown.length === 0 ? (
          <EmptyState title="Belum ada kampanye di sini">Coba ubah filter atau kata kunci.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((c) => <CampaignCard key={c.id} c={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}

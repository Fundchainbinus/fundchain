import { SDG_CATEGORIES } from '@fundchain/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CampaignCard } from '../components/CampaignCard';
import { EmptyState, ErrorBox, FilterTabs, InfoNote, Spinner, Stat } from '../components/ui';
import { get } from '../lib/api';
import { rupiah } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { CampaignDetail, CampaignSummary, MyDonation } from '../lib/types';

const PUBLIC = 'ACTIVE,COMPLETED,FROZEN';

function SummaryStats() {
  const { me } = useMe();
  const all = useQuery({
    queryKey: ['campaigns', 'public-summary'],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/campaigns', { status: PUBLIC, limit: 100 }),
  });
  const cs = all.data?.campaigns ?? [];
  // Ringkasan integritas hanya ada di detail kampanye (publik); detail ini juga dipakai ulang halaman kampanye.
  const details = useQueries({
    queries: cs.map((c) => ({ queryKey: ['campaign', c.id], queryFn: () => get<CampaignDetail>(`/campaigns/${c.id}`) })),
  });
  const mine = useQuery({ queryKey: ['me', 'donations'], queryFn: () => get<MyDonation[]>('/me/donations'), enabled: !!me });
  const by = (s: string) => cs.filter((c) => c.status === s).length;
  const paid = (mine.data ?? []).filter((d) => d.status === 'PAID');
  const integ = (k: 'VERIFIED' | 'TAMPERED' | 'PENDING') => details.reduce((n, q) => n + (q.data?.integritySummary[k] ?? 0), 0);
  const totalDonations = cs.reduce((n, c) => n + c.donorCount, 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat large label="Dana terkumpul" value={rupiah(cs.reduce((n, c) => n + c.currentAmount, 0))} hint={`Dari ${totalDonations} donasi berhasil`} />
      <Stat large label="Kampanye publik" value={`${cs.length} kampanye`} hint={`${by('ACTIVE')} Active · ${by('COMPLETED')} Completed · ${by('FROZEN')} Frozen`} />
      <Stat
        large
        label={me ? <>Donasi saya · <b className="font-semibold text-ink">{me.name.split(' ')[0]}</b></> : 'Donasi saya'}
        value={me ? rupiah(paid.reduce((n, d) => n + d.amount, 0)) : '—'}
        hint={me ? `${paid.length} pembayaran berhasil` : 'Login untuk melihat donasi Anda'}
      />
      <Stat
        large
        label="Integritas donasi"
        value={`${integ('VERIFIED')} / ${totalDonations} Verified`}
        hint={`${integ('TAMPERED')} Tampered · ${integ('PENDING')} Pending`}
      />
    </div>
  );
}

export function HomePage() {
  const [q, setQ] = useState('');
  const [sdg, setSdg] = useState('');
  const [status, setStatus] = useState('');
  const campaigns = useQuery({
    queryKey: ['campaigns', { q, sdg, status: PUBLIC }],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/campaigns', { q: q || undefined, sdg: sdg || undefined, status: PUBLIC, limit: 100 }),
  });
  const list = campaigns.data?.campaigns ?? [];
  const shown = list.filter((c) => !status || c.status === status);
  const n = (s: string) => list.filter((c) => c.status === s).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">FundChain</h1>
        <p className="mt-1 text-[13px] text-ink">Penggalangan dana mahasiswa BINUS · transparan dari donasi hingga pencairan.</p>
      </div>
      <InfoNote>
        Seluruh donasi lunas dibuat sidik jarinya (hash Keccak-256) lalu dicatat di blockchain. Blockchain hanya menyimpan hash bukti yang
        immutable, bukan dana donasi.
      </InfoNote>
      <SummaryStats />

      <section className="space-y-3">
        <h2 className="section-title">Jelajahi Kampanye</h2>
        <div className="grid gap-4 lg:grid-cols-[440px_290px_1fr] lg:items-end">
          <div>
            <label className="mb-2 block text-[13px] text-ink" htmlFor="q">Cari kampanye</label>
            <div className="relative">
              <input id="q" className="input pr-9" placeholder="Cari judul atau deskripsi…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-[13px] text-ink" htmlFor="sdg">Kategori SDG</label>
            <select id="sdg" className="input" value={sdg} onChange={(e) => setSdg(e.target.value)}>
              <option value="">Semua kategori SDG</option>
              {SDG_CATEGORIES.map((s) => (
                <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:pb-1">
            <FilterTabs
              value={status}
              onChange={setStatus}
              items={[
                { value: '', label: 'Semua', count: list.length },
                { value: 'ACTIVE', label: 'Active', count: n('ACTIVE') },
                { value: 'COMPLETED', label: 'Completed', count: n('COMPLETED') },
                { value: 'FROZEN', label: 'Frozen', count: n('FROZEN') },
              ]}
            />
          </div>
        </div>

        {campaigns.isLoading ? (
          <Spinner />
        ) : campaigns.error ? (
          <ErrorBox error={campaigns.error} />
        ) : shown.length === 0 ? (
          <EmptyState title="Belum ada kampanye di sini">Coba ubah filter atau kata kunci.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {shown.map((c) => <CampaignCard key={c.id} c={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}

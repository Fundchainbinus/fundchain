import { SDG_CATEGORIES } from '@fundchain/shared';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, Search, ShieldCheck, Snowflake } from 'lucide-react';
import { useState } from 'react';
import { CampaignCard } from '../components/CampaignCard';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { get } from '../lib/api';
import type { CampaignSummary } from '../lib/types';

const STATUS_TABS = [
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'COMPLETED', label: 'Selesai' },
  { value: 'FROZEN', label: 'Dibekukan' },
];

export function HomePage() {
  const [q, setQ] = useState('');
  const [sdg, setSdg] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const campaigns = useQuery({
    queryKey: ['campaigns', { q, sdg, status }],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/campaigns', { q: q || undefined, sdg: sdg || undefined, status }),
  });

  return (
    <div>
      <section className="mb-10 overflow-hidden rounded-2xl bg-gradient-to-br from-navy to-navy-dark px-6 py-10 text-white sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Fundraising mahasiswa BINUS</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl">
          Donasi yang bisa dibuktikan, bukan sekadar dipercaya.
        </h1>
        <p className="mt-3 max-w-2xl text-white/80">
          Setiap donasi yang lunas dibuat sidik jarinya (hash Keccak-256) lalu dicatat permanen di blockchain. Kalau data
          diubah diam-diam, sistem mendeteksinya dan pencairan dana otomatis dikunci.
        </p>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          {[
            { icon: <Fingerprint size={18} />, t: 'Hash setiap donasi', d: 'Bukti publik di smart contract' },
            { icon: <ShieldCheck size={18} />, t: 'Integrity checker', d: 'Data DB dibandingkan dengan on-chain' },
            { icon: <Snowflake size={18} />, t: 'Auto-freeze', d: 'Manipulasi → campaign dibekukan' },
          ].map((f) => (
            <div key={f.t} className="flex items-start gap-3 rounded-xl bg-white/10 p-3">
              <span className="text-accent">{f.icon}</span>
              <span><b className="block">{f.t}</b><span className="text-white/70">{f.d}</span></span>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={status === t.value}
              onClick={() => setStatus(t.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === t.value ? 'bg-white text-navy shadow-sm' : 'text-slate-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className="input pl-9" placeholder="Cari campaign…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari campaign" />
        </div>
        <select className="input lg:w-72" value={sdg} onChange={(e) => setSdg(e.target.value)} aria-label="Filter SDG">
          <option value="">Semua kategori SDG</option>
          {SDG_CATEGORIES.map((s) => (
            <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>
          ))}
        </select>
      </div>

      {campaigns.isLoading ? (
        <Spinner />
      ) : campaigns.error ? (
        <ErrorBox error={campaigns.error} />
      ) : campaigns.data!.campaigns.length === 0 ? (
        <EmptyState title="Belum ada campaign di sini">Coba ubah filter atau kata kunci.</EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.data!.campaigns.map((c) => <CampaignCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

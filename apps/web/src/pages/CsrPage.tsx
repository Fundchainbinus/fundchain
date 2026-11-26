import { useQuery } from '@tanstack/react-query';
import { Building2, ExternalLink, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBox, PageHeader, Panel, Spinner } from '../components/ui';
import { get } from '../lib/api';
import { rupiah } from '../lib/format';
import type { CsrCompany, CsrSponsor } from '../lib/types';

/** Mitra CSR di halaman campaign: hanya tampil bila ada kontribusi perusahaan yang lunas. */
export function CsrSponsors({ campaignId }: { campaignId: string }) {
  const q = useQuery({
    queryKey: ['campaign-csr', campaignId],
    queryFn: () => get<CsrSponsor[]>(`/campaigns/${campaignId}/csr-sponsors`),
  });
  if (!q.data?.length) return null;
  return (
    <Panel title="Didukung mitra CSR">
      <ul className="flex flex-wrap gap-2">
        {q.data.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded border border-line px-3 py-2 text-[13px]">
            <Building2 size={16} className="shrink-0 text-navy" aria-hidden="true" />
            <span className="font-semibold text-ink">{s.name}</span>
            <span className="text-slate-500">{s.sector}</span>
            <span className="whitespace-nowrap font-semibold text-emerald-700">{rupiah(s.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Kontribusi CSR dicatat seperti donasi lain: hash-nya disimpan di blockchain dan ikut aturan pencairan bertahap.
      </p>
    </Panel>
  );
}

export function CsrPage() {
  const q = useQuery({ queryKey: ['csr-companies'], queryFn: () => get<CsrCompany[]>('/csr/companies') });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mitra CSR"
        subtitle="Perusahaan yang menyalurkan dana CSR ke proyek sosial mahasiswa BINUS lewat FundChain."
      />
      <Panel title="Kenapa lewat FundChain">
        <ul className="grid gap-3 text-[13px] text-ink sm:grid-cols-3">
          <li className="flex gap-2">
            <ShieldCheck size={18} className="shrink-0 text-navy" aria-hidden="true" />
            Setiap kontribusi dicatat hash-nya di blockchain, sehingga perubahan data bisa dideteksi.
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={18} className="shrink-0 text-navy" aria-hidden="true" />
            Dana dicairkan bertahap 20% sampai 100%, setiap tahap dengan bukti penggunaan yang ditinjau admin BINUS.
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={18} className="shrink-0 text-navy" aria-hidden="true" />
            Laporan penggunaan dana per campaign terbuka untuk publik dan bisa dipakai untuk laporan keberlanjutan perusahaan.
          </li>
        </ul>
        <p className="mt-4 text-[13px] text-slate-500">
          Ingin menjadi mitra? Hubungi admin FundChain BINUS untuk penandatanganan MoU. Dana ditransfer ke rekening resmi, lalu admin mencatatnya ke campaign pilihan.
        </p>
      </Panel>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState title="Belum ada mitra CSR">Mitra yang sudah menandatangani MoU akan tampil di sini.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((c) => (
            <div key={c.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.sector}</p>
                </div>
                <p className="whitespace-nowrap text-[15px] font-semibold text-emerald-700">{rupiah(c.totalContributed)}</p>
              </div>
              {c.description && <p className="text-[13px] text-ink [overflow-wrap:anywhere]">{c.description}</p>}
              {c.website && (
                <a href={c.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-navy hover:underline">
                  {c.website.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
                </a>
              )}
              {c.campaigns.length > 0 ? (
                <ul className="space-y-1 border-t border-line pt-3 text-[13px]">
                  {c.campaigns.map((x) => (
                    <li key={x.id} className="flex items-baseline justify-between gap-3">
                      <Link to={`/campaigns/${x.id}`} className="min-w-0 text-ink hover:text-navy hover:underline [overflow-wrap:anywhere]">{x.title}</Link>
                      <span className="whitespace-nowrap text-slate-500">{rupiah(x.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-line pt-3 text-xs text-slate-500">Belum ada kontribusi tercatat.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

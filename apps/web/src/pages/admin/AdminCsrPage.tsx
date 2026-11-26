import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, InfoNote, PageHeader, Panel, Spinner, SuccessBox } from '../../components/ui';
import { get, post } from '../../lib/api';
import { rupiah } from '../../lib/format';
import type { CampaignSummary, CsrCompany } from '../../lib/types';

/** Admin: daftarkan mitra CSR dan catat dana CSR yang sudah masuk rekening. */
export function AdminCsrPage() {
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: ['csr-companies'], queryFn: () => get<CsrCompany[]>('/csr/companies') });
  const campaigns = useQuery({
    queryKey: ['admin', 'campaigns', 'ACTIVE'],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>('/admin/campaigns', { status: 'ACTIVE', limit: 100 }),
  });

  const [co, setCo] = useState({ name: '', sector: '', website: '', description: '' });
  const createCompany = useMutation({
    mutationFn: () => post<CsrCompany>('/admin/csr/companies', { ...co, website: co.website || undefined, description: co.description || undefined }),
    onSuccess: () => {
      setCo({ name: '', sector: '', website: '', description: '' });
      void qc.invalidateQueries({ queryKey: ['csr-companies'] });
    },
  });

  const [ct, setCt] = useState({ companyId: '', campaignId: '', amount: 0, reference: '' });
  const record = useMutation({
    mutationFn: () => post<{ donationId: string; amount: number; company: string }>('/admin/csr/contributions', ct),
    onSuccess: () => {
      setCt((x) => ({ ...x, amount: 0, reference: '' }));
      void qc.invalidateQueries();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Mitra CSR" subtitle={<>Daftar publik ada di <Link to="/csr" className="text-navy hover:underline">halaman Mitra CSR</Link>.</>} />

      <Panel title="Catat dana CSR yang sudah diterima">
        <InfoNote>
          Catat hanya setelah dana masuk ke rekening resmi. Kontribusi dicatat sebagai donasi lunas: di-hash, dinotarisasi ke blockchain, dan menambah dana terkumpul campaign.
        </InfoNote>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor="csr-company">Mitra *</label>
            <select id="csr-company" className="input" value={ct.companyId} onChange={(e) => setCt({ ...ct, companyId: e.target.value })}>
              <option value="">Pilih mitra</option>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="csr-campaign">Campaign ACTIVE *</label>
            <select id="csr-campaign" className="input" value={ct.campaignId} onChange={(e) => setCt({ ...ct, campaignId: e.target.value })}>
              <option value="">Pilih campaign</option>
              {campaigns.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="csr-amount">Nominal diterima (IDR) *</label>
            <input id="csr-amount" type="number" min={10_000} className="input" value={ct.amount || ''} onChange={(e) => setCt({ ...ct, amount: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label" htmlFor="csr-ref">No. referensi transfer / MoU *</label>
            <input id="csr-ref" className="input" value={ct.reference} placeholder="TRF/2026/11/0042" onChange={(e) => setCt({ ...ct, reference: e.target.value })} />
            <p className="mt-1 text-xs text-slate-500">Satu referensi hanya bisa dicatat sekali.</p>
          </div>
          <div className="sm:col-span-2 space-y-3">
            <ErrorBox error={record.error} />
            {record.isSuccess && (
              <SuccessBox>
                {rupiah(record.data.amount)} dari {record.data.company} tercatat.{' '}
                <Link to={`/donations/${record.data.donationId}`} className="underline">Lihat bukti</Link>
              </SuccessBox>
            )}
            <button className="btn-primary font-normal" disabled={record.isPending || !ct.companyId || !ct.campaignId || ct.amount < 10_000 || ct.reference.trim().length < 4}>
              {record.isPending ? 'Mencatat…' : 'Catat kontribusi'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Daftarkan mitra baru">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createCompany.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor="co-name">Nama perusahaan *</label>
            <input id="co-name" className="input" value={co.name} onChange={(e) => setCo({ ...co, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="co-sector">Sektor *</label>
            <input id="co-sector" className="input" value={co.sector} placeholder="Contoh: Perbankan" onChange={(e) => setCo({ ...co, sector: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="co-web">Website</label>
            <input id="co-web" className="input" value={co.website} placeholder="https://" onChange={(e) => setCo({ ...co, website: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="co-desc">Fokus program CSR</label>
            <input id="co-desc" className="input" value={co.description} onChange={(e) => setCo({ ...co, description: e.target.value })} />
          </div>
          <div className="sm:col-span-2 space-y-3">
            <ErrorBox error={createCompany.error} />
            {createCompany.isSuccess && <SuccessBox>Mitra {createCompany.data.name} terdaftar.</SuccessBox>}
            <button className="btn-secondary" disabled={createCompany.isPending || co.name.trim().length < 3 || co.sector.trim().length < 3}>
              {createCompany.isPending ? 'Menyimpan…' : 'Daftarkan mitra'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Mitra terdaftar">
        {companies.isLoading ? (
          <Spinner />
        ) : !companies.data?.length ? (
          <p className="text-[13px] text-slate-500">Belum ada mitra.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="tbl text-[13px]">
              <thead>
                <tr><th>Mitra</th><th>Sektor</th><th>Campaign didukung</th><th>Total</th></tr>
              </thead>
              <tbody>
                {companies.data.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name}</td>
                    <td>{c.sector}</td>
                    <td>{c.campaigns.length}</td>
                    <td className="whitespace-nowrap">{rupiah(c.totalContributed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

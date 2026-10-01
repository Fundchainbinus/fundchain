import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Snowflake } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api, get } from '../lib/api';
import { rupiah } from '../lib/format';
import type { CampaignDetail } from '../lib/types';

export function DisbursePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const campaign = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`) });
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('amount', String(amount));
      fd.append('description', description);
      if (file) fd.append('proof', file);
      return api.post(`/campaigns/${id}/disbursements`, fd);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate(`/campaigns/${id}`);
    },
  });

  if (campaign.isLoading) return <Spinner />;
  if (campaign.error) return <ErrorBox error={campaign.error} />;
  const c = campaign.data!;
  if (!c.viewer.isOwner) return <ErrorBox error="Hanya pembuat campaign yang dapat mengajukan pencairan." />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Ajukan pencairan dana" subtitle={c.title} />
      {c.status === 'FROZEN' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <Snowflake size={18} className="shrink-0" />
          Campaign dibekukan karena integritas data bermasalah. Pencairan dana terkunci sampai admin menyelesaikan investigasi.
        </div>
      )}
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="rounded-lg bg-navy-50 p-4 text-sm">
          Sisa dana yang dapat diajukan: <b className="text-navy">{rupiah(c.funds.available)}</b>
          <span className="block text-xs text-slate-500">Terkumpul {rupiah(c.funds.raised)} − sudah diajukan/dicairkan {rupiah(c.funds.raised - c.funds.available)}</span>
        </div>
        <div>
          <label className="label" htmlFor="amount">Nominal (Rp)</label>
          <input id="amount" type="number" className="input" min={1} max={c.funds.available} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="desc">Penggunaan dana / milestone</label>
          <textarea id="desc" className="input min-h-[100px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: Pembelian pipa & tandon tahap 1 sesuai RAB." />
        </div>
        <div>
          <label className="label" htmlFor="proof">Bukti milestone / rencana penggunaan (PDF, PNG, JPG — maks. 5MB)</label>
          <input id="proof" type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <ErrorBox error={create.error} />
        <div className="flex justify-end gap-2">
          <Link to={`/campaigns/${id}`} className="btn-secondary">Batal</Link>
          <button className="btn-primary" disabled={create.isPending || !amount || !file || description.trim().length < 10}>
            {create.isPending ? 'Mengirim…' : 'Ajukan pencairan'}
          </button>
        </div>
      </form>
    </div>
  );
}

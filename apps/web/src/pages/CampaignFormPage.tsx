import { FileButton } from '../components/FileButton';
import { LIMITS, SDG_CATEGORIES, SDG_CODES } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ErrorBox, PageHeader, Spinner, SuccessBox } from '../components/ui';
import { api, get, patch, post } from '../lib/api';
import { dateTime } from '../lib/format';
import type { CampaignDetail } from '../lib/types';

const schema = z.object({
  title: z.string().trim().min(LIMITS.TITLE_MIN, `Judul minimal ${LIMITS.TITLE_MIN} karakter`).max(LIMITS.TITLE_MAX),
  description: z.string().trim().min(LIMITS.DESCRIPTION_MIN, `Deskripsi minimal ${LIMITS.DESCRIPTION_MIN} karakter`),
  sdgCategory: z.enum(SDG_CODES as [string, ...string[]], { message: 'Pilih kategori SDG' }),
  targetAmount: z
    .number({ message: 'Target wajib diisi' })
    .int('Target harus bilangan bulat')
    .min(LIMITS.DONATION_MIN, 'Target minimal Rp10.000')
    .max(LIMITS.TARGET_MAX, 'Target maksimal Rp1.000.000.000'),
  deadline: z.string().refine((v) => v && new Date(v).getTime() > (Date.now() + 1 * 86_400_000), 'Deadline minimal 2 hari dari hari ini'),
});
type Form = z.infer<typeof schema>;

const toDateInput = (iso: string) => iso.slice(0, 10);
const defaultDeadline = () => toDateInput(new Date(Date.now() + 30 * 86_400_000).toISOString());

export function CampaignFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`), enabled: !!id });
  const [form, setForm] = useState<Form>({ title: '', description: '', sdgCategory: '', targetAmount: 5_000_000, deadline: defaultDeadline() });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [file, setFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const c = existing.data;
    if (c) setForm({ title: c.title, description: c.description, sdgCategory: c.sdgCategory, targetAmount: c.targetAmount, deadline: toDateInput(c.deadline) });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: (data: Form) => {
      // Deadline = akhir hari yang dipilih (WIB tidak relevan untuk demo, simpan sebagai ISO).
      const body = { ...data, deadline: new Date(`${data.deadline}T23:59:59`).toISOString() };
      return id ? patch<CampaignDetail>(`/campaigns/${id}`, body) : post<CampaignDetail>('/campaigns', body);
    },
    onSuccess: (c) => {
      void qc.invalidateQueries();
      setSaved(true);
      if (!id) navigate(`/campaigns/${c.id}/edit`, { replace: true });
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      return api.post(`/campaigns/${id}/documents`, fd);
    },
    onSuccess: () => {
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });
  const submit = useMutation({
    mutationFn: () => post(`/campaigns/${id}/submit`),
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate(`/campaigns/${id}`);
    },
  });

  if (id && existing.isLoading) return <Spinner />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const c = existing.data;
  const locked = c && !['DRAFT', 'REJECTED'].includes(c.status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={id ? 'Edit campaign' : 'Buat campaign baru'}
        subtitle="Lengkapi data, unggah proposal PDF, lalu ajukan untuk direview admin BINUS."
      />
      {c?.status === 'REJECTED' && <div className="mb-4"><ErrorBox error={`Ditolak: ${c.rejectionReason}`} /></div>}
      {locked && <div className="mb-4"><ErrorBox error="Campaign sudah diajukan/aktif sehingga tidak bisa diedit." /></div>}

      <form className="card space-y-4 p-6" onSubmit={onSave}>
        <fieldset disabled={!!locked} className="space-y-4">
          <div>
            <label className="label" htmlFor="title">Judul</label>
            <input id="title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
          </div>
          <div>
            <label className="label" htmlFor="description">Deskripsi & rencana penggunaan dana</label>
            <textarea id="description" className="input min-h-[140px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="label" htmlFor="sdg">Kategori SDG</label>
              <select id="sdg" className="input" value={form.sdgCategory} onChange={(e) => set('sdgCategory', e.target.value)}>
                <option value="">Pilih…</option>
                {SDG_CATEGORIES.map((s) => <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>)}
              </select>
              {errors.sdgCategory && <p className="mt-1 text-xs text-red-600">{errors.sdgCategory}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="target">Target dana (Rp)</label>
              <input id="target" type="number" className="input" min={LIMITS.DONATION_MIN} step={10000} value={form.targetAmount || ''} onChange={(e) => set('targetAmount', Number(e.target.value))} />
              {errors.targetAmount && <p className="mt-1 text-xs text-red-600">{errors.targetAmount}</p>}
            </div>
            <div>
              <label className="label" htmlFor="deadline">Deadline</label>
              <input id="deadline" type="date" className="input" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
              {errors.deadline && <p className="mt-1 text-xs text-red-600">{errors.deadline}</p>}
            </div>
          </div>
        </fieldset>
        <ErrorBox error={save.error} />
        {saved && !save.isPending && <SuccessBox>Tersimpan sebagai draft.</SuccessBox>}
        {!locked && (
          <div className="flex justify-end">
            <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Menyimpan…' : id ? 'Simpan perubahan' : 'Simpan draft'}</button>
          </div>
        )}
      </form>

      {id && c && !locked && (
        <div className="card mt-6 p-6">
          <h2 className="flex items-center gap-2 font-semibold"><FileUp size={18} className="text-navy" /> Proposal (PDF, maks. 4MB)</h2>
          {c.documents.length > 0 ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={16} /> Terunggah:
              <FileButton linkPath={`/documents/${c.documents[0].id}/link`} className="underline">
                {c.documents[0].originalName}
              </FileButton>
              <span className="text-xs text-slate-500">({dateTime(c.documents[0].createdAt)})</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Belum ada proposal. Wajib diunggah sebelum diajukan.</p>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input type="file" accept="application/pdf,.pdf" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Pilih file proposal" />
            <button className="btn-secondary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
              {upload.isPending ? 'Mengunggah…' : c.documents.length ? 'Ganti proposal' : 'Unggah'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Butuh contoh? Pakai <code>samples/proposal-contoh.pdf</code> di folder project.</p>
          <div className="mt-3"><ErrorBox error={upload.error} /></div>

          <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">Setelah diajukan, campaign tidak bisa diedit sampai admin memberi keputusan.</p>
            <button className="btn-primary" disabled={!c.documents.length || submit.isPending} onClick={() => submit.mutate()}>
              <Send size={16} /> {c.status === 'REJECTED' ? 'Ajukan ulang' : 'Ajukan untuk review'}
            </button>
          </div>
          <div className="mt-3"><ErrorBox error={submit.error} /></div>
        </div>
      )}
      {id && <p className="mt-4 text-sm"><Link to={`/campaigns/${id}`} className="text-navy hover:underline">← Lihat halaman campaign</Link></p>}
    </div>
  );
}

import { FileButton } from '../components/FileButton';
import { LIMITS, SDG_CATEGORIES, SDG_CODES } from '@fundchain/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ErrorBox, InfoNote, PageHeader, Spinner, SuccessBox } from '../components/ui';
import { api, get, patch, post } from '../lib/api';
import { dateTime, fileSize } from '../lib/format';
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
  deadline: z.string().min(1, 'Deadline wajib diisi'),
});
type Form = z.infer<typeof schema>;

const toDateInput = (iso: string) => iso.slice(0, 10);
/** Tanggal lokal (YYYY-MM-DD) paling awal yang boleh dipilih sebagai deadline. */
const minDeadline = () => {
  const d = new Date();
  d.setDate(d.getDate() + LIMITS.DEADLINE_MIN_DAYS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const defaultDeadline = () => toDateInput(new Date(Date.now() + 30 * 86_400_000).toISOString());

export function CampaignFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <p className="text-sm text-slate-500">
        <Link to="/my/campaigns" className="text-navy hover:underline">Ruang Mahasiswa</Link> / Buat / Edit Kampanye
      </p>
      <PageHeader title={id ? 'Edit Kampanye' : 'Buat Kampanye'} />
      <CampaignFormCard
        key={id ?? 'new'}
        id={id}
        onCreated={(newId) => navigate(`/campaigns/${newId}/edit`, { replace: true })}
        onSubmitted={() => navigate(`/campaigns/${id}`)}
      />
    </div>
  );
}

/** Form "Buat / Edit Kampanye" (dipakai halaman form dan Ruang Mahasiswa). */
export function CampaignFormCard({ id, onCreated, onSubmitted }: { id?: string; onCreated?: (id: string) => void; onSubmitted?: () => void }) {
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
      if (!id) onCreated?.(c.id);
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
      onSubmitted?.();
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
    // Deadline yang tidak diubah saat edit tetap boleh disimpan walau sudah < H+2.
    const unchanged = c && form.deadline === toDateInput(c.deadline);
    if (!unchanged && form.deadline < minDeadline()) {
      setErrors({ deadline: `Deadline minimal ${LIMITS.DEADLINE_MIN_DAYS} hari dari hari ini` });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const doc = c?.documents[0];
  return (
    <div className="space-y-3">
      {c?.status === 'REJECTED' && <InfoNote tone="amber">Ditolak: {c.rejectionReason}</InfoNote>}
      {locked && <InfoNote tone="red">Kampanye sudah diajukan/aktif sehingga tidak bisa diedit.</InfoNote>}

      <form className="card space-y-4 p-4" onSubmit={onSave}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-ink">{c ? `${c.title} · ${c.status === 'DRAFT' ? 'belum dipublikasikan' : 'revisi'}` : 'Kampanye baru · belum dipublikasikan'}</p>
          <span className="badge bg-[#F1F3F4] text-slate-600">{c ? (c.status === 'PENDING_REVIEW' ? 'Pending' : c.status) : 'Draft'}</span>
        </div>
        <fieldset disabled={!!locked} className="space-y-4">
          <div>
            <label className="label" htmlFor="title">Judul kampanye *</label>
            <input id="title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
          </div>
          <div>
            <label className="label" htmlFor="description">Deskripsi & rencana penggunaan dana *</label>
            <textarea id="description" className="input min-h-[76px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description}</p>}
          </div>
          <div>
            <label className="label" htmlFor="sdg">Kategori SDG *</label>
            <select id="sdg" className="input" value={form.sdgCategory} onChange={(e) => set('sdgCategory', e.target.value)}>
              <option value="">Pilih…</option>
              {SDG_CATEGORIES.map((s) => <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>)}
            </select>
            {errors.sdgCategory && <p className="mt-1 text-xs text-red-600">{errors.sdgCategory}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="target">Target dana (IDR) *</label>
              <input id="target" type="number" className="input" min={LIMITS.DONATION_MIN} step={10000} value={form.targetAmount || ''} onChange={(e) => set('targetAmount', Number(e.target.value))} />
              {errors.targetAmount && <p className="mt-1 text-xs text-red-600">{errors.targetAmount}</p>}
            </div>
            <div>
              <label className="label" htmlFor="deadline">Batas waktu *</label>
              <input id="deadline" type="date" className="input" min={minDeadline()} value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
              {errors.deadline ? <p className="mt-1 text-xs text-red-600">{errors.deadline}</p> : <p className="mt-1 text-xs text-slate-500">Harus tanggal di masa depan.</p>}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="proposal">Upload proposal PDF *</label>
            {doc && (
              <p className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-ink">
                <FileButton linkPath={`/documents/${doc.id}/link`} className="hover:underline">{doc.originalName}</FileButton>
                · {fileSize(doc.size)} <CheckCircle2 size={14} className="text-emerald-600" /> <span className="text-xs text-slate-500">({dateTime(doc.createdAt)})</span>
              </p>
            )}
            <div className="flex gap-2">
              <input
                id="proposal"
                type="file"
                accept="application/pdf,.pdf"
                className="input"
                disabled={!id}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {id && (
                <button type="button" className="btn-secondary" disabled={!file || upload.isPending} onClick={() => upload.mutate()} aria-label="Unggah proposal">
                  <FileUp size={15} /> {upload.isPending ? 'Mengunggah…' : doc ? 'Ganti' : 'Unggah'}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {id ? 'Wajib PDF · maksimum 4 MB.' : 'Simpan draft dulu, lalu unggah proposal (PDF · maksimum 4 MB).'}
            </p>
          </div>
        </fieldset>
        <ErrorBox error={save.error ?? upload.error ?? submit.error} />
        {saved && !save.isPending && <SuccessBox>Tersimpan sebagai draft.</SuccessBox>}
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary font-normal" disabled={save.isPending}>{save.isPending ? 'Menyimpan…' : 'Simpan draft'}</button>
            <button type="button" className="btn-primary font-normal" disabled={!id || !doc || submit.isPending} onClick={() => submit.mutate()}>
              <Send size={14} /> {c?.status === 'REJECTED' ? 'Ajukan ulang' : 'Kirim untuk review admin'}
            </button>
          </div>
        )}
        <p className="text-xs text-slate-500">Kampanye baru menerima donasi setelah disetujui dan berstatus ACTIVE.</p>
      </form>
    </div>
  );
}

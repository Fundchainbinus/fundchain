import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import { get } from '../lib/api';
import type { CampaignDetail, Milestones } from '../lib/types';
import { date, percent, rupiah } from '../lib/format';
import { DisbursementBadge, ErrorBox } from './ui';

type Funds = CampaignDetail['funds'];

const SEGMENTS: { key: 'disbursed' | 'approved' | 'requested' | 'available'; label: string; bar: string; swatch: string }[] = [
  { key: 'disbursed', label: 'Sudah dicairkan', bar: 'bg-emerald-600', swatch: 'bg-emerald-600' },
  { key: 'approved', label: 'Disetujui, belum dibayar', bar: 'bg-navy', swatch: 'bg-navy' },
  { key: 'requested', label: 'Diajukan', bar: 'bg-amber-400', swatch: 'bg-amber-400' },
  { key: 'available', label: 'Sisa dapat dicairkan', bar: 'bg-[#E8EEF1]', swatch: 'bg-[#E8EEF1] ring-1 ring-inset ring-slate-300' },
];

const STEP = {
  PAID: { label: 'Selesai', icon: CheckCircle2, cls: 'text-emerald-600' },
  APPROVED: { label: 'Berjalan', icon: Clock, cls: 'text-navy' },
  REQUESTED: { label: 'Berjalan', icon: CircleDashed, cls: 'text-amber-600' },
} as const;

/** Bar dana + tahapan milestone. Tahapan dari GET /campaigns/:id/milestones (publik, BFD-97/BFD-103). */
export function MilestoneProgress({ campaignId, target, funds }: { campaignId: string; target: number; funds: Funds }) {
  const milestones = useQuery({
    queryKey: ['campaign-milestones', campaignId],
    queryFn: () => get<Milestones>(`/campaigns/${campaignId}/milestones`),
  });
  const raised = funds.raised;
  const pct = percent(raised, target);
  const realPct = target > 0 ? Math.round((raised / target) * 100) : 0;
  // Penyebut = total semua segmen, agar bar tidak meluap meski komitmen > terkumpul (mis. setelah refund).
  const total = Math.max(raised, funds.disbursed + funds.approved + funds.requested + funds.available);
  const usedPct = total > 0 ? Math.round((funds.disbursed / total) * 100) : 0;
  const m = milestones.data;
  const steps = m?.steps ?? [];

  return (
    <div className="min-w-0 space-y-5 rounded-md border border-line p-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-ink">Dana terkumpul</p>
          <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">
            {rupiah(raised)} dari {target > 0 ? rupiah(target) : 'target belum ditentukan'}
            {target > 0 && ` · ${realPct}%`}
          </p>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#E8EEF1]"
          role="progressbar"
          aria-label="Dana terkumpul terhadap target"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={target > 0 ? `${rupiah(raised)} dari ${rupiah(target)} (${realPct}%)` : 'Target belum ditentukan'}
        >
          <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${pct}%` }} />
        </div>
        {target > 0 && raised > target && (
          <p className="mt-1 text-xs text-emerald-700">Melampaui target sebesar {rupiah(raised - target)}.</p>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Penggunaan dana terkumpul</p>
        <div
          className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[#E8EEF1]"
          role="progressbar"
          aria-label="Dana yang sudah dicairkan dari total dana terkumpul"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPct}
          aria-valuetext={`${usedPct}% sudah dicairkan`}
        >
          {total > 0 &&
            SEGMENTS.map((s) =>
              funds[s.key] > 0 ? (
                <div key={s.key} className={`h-full ${s.bar}`} style={{ width: `${(funds[s.key] / total) * 100}%` }} title={`${s.label}: ${rupiah(funds[s.key])}`} />
              ) : null,
            )}
        </div>
        <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.swatch}`} aria-hidden="true" />
              <span className="text-slate-500">{s.label}</span>
              <span className="ml-auto whitespace-nowrap font-semibold text-ink">{rupiah(funds[s.key])}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-ink">Tahapan milestone</p>
          {m && m.total > 0 && (
            <p className="text-xs text-slate-500">
              {m.completed} dari {m.maxSteps} tahap selesai
              {m.current ? ` · tahap ${m.current.step} berjalan` : ''}
            </p>
          )}
        </div>
        {milestones.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Memuat milestone…</p>
        ) : milestones.error ? (
          <div className="mt-2"><ErrorBox error={milestones.error} /></div>
        ) : steps.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Belum ada milestone pencairan. Dana dicairkan dalam 5 tahap: 20%, 40%, 60%, 80%, 100%.</p>
        ) : (
          <ol className="mt-3">
            {steps.map((d) => {
              const st = STEP[d.status];
              const Icon = st.icon;
              const last = d.step === steps.length;
              return (
                <li key={d.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {!last && <span className="absolute left-[9px] top-6 bottom-0 w-px bg-line" aria-hidden="true" />}
                  <Icon size={20} className={`relative shrink-0 bg-white ${st.cls}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm text-ink [overflow-wrap:anywhere]">
                        <span className="text-slate-500">Tahap {d.step} ({d.percent}%) · </span>
                        {d.description}
                      </p>
                      <p className="whitespace-nowrap text-sm font-semibold text-ink">{rupiah(d.amount)}</p>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span className={`font-semibold ${st.cls}`}>{st.label}</span>
                      <span aria-hidden="true">·</span>
                      <DisbursementBadge status={d.status} />
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Diajukan {date(d.requestedAt)}
                      {d.approvedAt && ` · disetujui ${date(d.approvedAt)}`}
                      {d.paidAt && ` · dibayar ${date(d.paidAt)}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

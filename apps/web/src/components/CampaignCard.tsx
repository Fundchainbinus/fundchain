import { Link } from 'react-router-dom';
import { date, percent, rupiah, sdg } from '../lib/format';
import type { CampaignSummary } from '../lib/types';
import { CampaignBadge, ProgressBar } from './ui';

/** Warna resmi tiap SDG, dipakai sebagai sampul kartu (campaign belum punya foto). */
const SDG_COLORS = [
  '#E5243B', '#DDA63A', '#4C9F38', '#C5192D', '#FF3A21', '#26BDE2', '#FCC30B', '#A21942', '#FD6925',
  '#DD1367', '#FD9D24', '#BF8B2E', '#3F7E44', '#0A97D9', '#56C02B', '#00689D', '#19486A',
];

export function CampaignCard({ c, to }: { c: CampaignSummary; to?: string }) {
  const s = sdg(c.sdgCategory);
  const color = SDG_COLORS[(s?.number ?? 1) - 1];
  const href = to ?? `/campaigns/${c.id}`;
  return (
    <div className={`card flex flex-col overflow-hidden ${c.status === 'FROZEN' ? 'border-red-200' : ''}`}>
      <Link to={href} className="relative flex h-28 items-end p-3" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}>
        <span className="text-5xl font-bold leading-none text-white/30">{s?.number}</span>
        <span className="absolute right-3 top-3 text-[11px] font-medium text-white/90">{date(c.deadline)}</span>
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <CampaignBadge status={c.status} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">SDG {s?.number} · {s?.label}</p>
        <Link to={href} className="mt-1 line-clamp-2 text-sm font-semibold text-slate-900 hover:text-brand">{c.title}</Link>
        <p className="mt-1 text-[11px] text-slate-500">Oleh {c.creator.name} · {c.donorCount} donasi</p>
        <div className="mt-auto pt-3">
          <ProgressBar current={c.currentAmount} target={c.targetAmount} danger={c.status === 'FROZEN'} />
          <p className="mt-1.5 text-xs font-semibold text-slate-900">
            {rupiah(c.currentAmount)} · {percent(c.currentAmount, c.targetAmount)}%
          </p>
          <p className="text-[11px] text-slate-500">Target {rupiah(c.targetAmount)}</p>
          <div className="mt-3 flex gap-2">
            <Link to={href} className="btn-secondary btn-sm">Detail</Link>
            {c.status === 'ACTIVE' ? (
              <Link to={href} className="btn-primary btn-sm">Donasi</Link>
            ) : (
              (c.status === 'COMPLETED' || c.status === 'FROZEN') && (
                <span className="btn btn-sm bg-slate-100 text-slate-500">
                  {c.status === 'FROZEN' ? 'Donasi dibekukan' : 'Donasi ditutup'}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

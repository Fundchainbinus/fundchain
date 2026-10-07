import { Link } from 'react-router-dom';
import { date, percent, rupiah, sdg } from '../lib/format';
import type { CampaignSummary } from '../lib/types';
import { CampaignBadge, ProgressBar } from './ui';

// Kampanye belum punya foto sendiri; sampul memakai foto ilustrasi dari Figma sesuai tema SDG.
const COVER_BY_SDG: Record<number, string> = {
  1: 'pangan', 2: 'pangan', 3: 'pangan',
  4: 'pendidikan', 5: 'pendidikan', 8: 'pendidikan', 9: 'pendidikan', 10: 'pendidikan', 16: 'pendidikan', 17: 'pendidikan',
  6: 'air', 14: 'air',
  7: 'lingkungan', 11: 'lingkungan', 12: 'lingkungan', 13: 'lingkungan', 15: 'lingkungan',
};

export function SdgCover({ code, className = 'h-[144px]' }: { code: string; className?: string }) {
  const s = sdg(code);
  const cover = COVER_BY_SDG[s?.number ?? 4] ?? 'pendidikan';
  return <img src={`/figma/cover-${cover}.jpg`} alt="" className={`w-full object-cover ${className}`} />;
}

export function CampaignCard({ c, to }: { c: CampaignSummary; to?: string }) {
  const s = sdg(c.sdgCategory);
  const href = to ?? `/campaigns/${c.id}`;
  const closedLabel = c.status === 'FROZEN' ? 'Donasi dibekukan' : c.status === 'ACTIVE' ? null : 'Donasi ditutup';
  return (
    <div className="card flex flex-col overflow-hidden">
      <Link to={href} tabIndex={-1}>
        <SdgCover code={c.sdgCategory} />
      </Link>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-4">
        <div className="flex items-start justify-between gap-2">
          <CampaignBadge status={c.status} />
          <span className="text-xs text-slate-500">{date(c.deadline)}</span>
        </div>
        <p className="mt-3 text-xs text-slate-500">{s ? `SDG ${s.number} · ${s.label}` : c.sdgCategory}</p>
        <Link to={href} className="mt-2 line-clamp-2 text-[17px] font-medium text-ink hover:text-navy [overflow-wrap:anywhere]">
          {c.title}
        </Link>
        <p className="mt-2 text-[13px] text-ink [overflow-wrap:anywhere]">Oleh {c.creator.name} · {c.donorCount} donasi</p>
        <div className="mt-auto pt-3">
          <ProgressBar current={c.currentAmount} target={c.targetAmount} danger={c.status === 'FROZEN'} />
          <p className="mt-3 text-sm font-semibold text-ink">
            {rupiah(c.currentAmount)} · {percent(c.currentAmount, c.targetAmount)}%
          </p>
          <p className="mt-2 text-xs text-slate-500">Target {rupiah(c.targetAmount)}</p>
          <div className="mt-3 flex gap-2">
            <Link to={href} className="btn-secondary">Detail</Link>
            {closedLabel ? (
              <span className="btn cursor-not-allowed border border-line bg-[#ECEFF1] font-normal text-slate-500">{closedLabel}</span>
            ) : (
              <Link to={`${href}#donasi`} className="btn-primary font-normal">Donasi</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

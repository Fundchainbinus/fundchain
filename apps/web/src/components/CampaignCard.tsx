import { Snowflake, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { daysLeft, percent, rupiah } from '../lib/format';
import type { CampaignSummary } from '../lib/types';
import { CampaignBadge, ProgressBar, SdgTag } from './ui';

export function CampaignCard({ c, to }: { c: CampaignSummary; to?: string }) {
  const left = daysLeft(c.deadline);
  return (
    <Link
      to={to ?? `/campaigns/${c.id}`}
      className={`card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md ${c.status === 'FROZEN' ? 'border-red-200' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SdgTag code={c.sdgCategory} />
        {c.status !== 'ACTIVE' && <CampaignBadge status={c.status} />}
      </div>
      <h3 className="mt-3 line-clamp-2 text-base font-semibold group-hover:text-navy">{c.title}</h3>
      <p className="mt-1 text-xs text-slate-500">oleh {c.creator.name}</p>
      <p className="mt-3 line-clamp-2 text-sm text-slate-600">{c.description}</p>
      <div className="mt-auto pt-5">
        {c.status === 'FROZEN' && (
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-red-700">
            <Snowflake size={14} /> Dibekukan — integritas data bermasalah
          </p>
        )}
        <ProgressBar current={c.currentAmount} target={c.targetAmount} />
        <div className="mt-2 flex items-baseline justify-between text-sm">
          <span className="font-semibold text-slate-900">{rupiah(c.currentAmount)}</span>
          <span className="text-xs text-slate-500">{percent(c.currentAmount, c.targetAmount)}% dari {rupiah(c.targetAmount)}</span>
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Users size={12} /> {c.donorCount} donatur</span>
          <span>{left > 0 ? `${left} hari lagi` : 'Berakhir'}</span>
        </div>
      </div>
    </Link>
  );
}

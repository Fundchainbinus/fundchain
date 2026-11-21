import { useQuery } from "@tanstack/react-query";
import { Award, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorBox, PageHeader, Panel, Spinner } from "../components/ui";
import { date, rupiah } from "../lib/format";
import { fetchMyPoints } from "../lib/points";
import type { PointsSummary } from "../lib/types";

const link = "text-ink hover:text-navy hover:underline";
const num = (n: number) => n.toLocaleString("id-ID");

function PointsSummaryCard({ data }: { data: PointsSummary }) {
  return (
    <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy-light text-navy">
          <Award size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] text-slate-500">Total poin</p>
          <p className="text-[32px] font-semibold leading-tight text-ink">{num(data.total)}</p>
        </div>
      </div>
      <div className="min-w-0 space-y-1 sm:text-right">
        <p className="text-[13px] text-ink">
          Dari <span className="font-semibold">{num(data.entries.length)}</span> donasi lunas
        </p>
        <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">{data.rule}</p>
      </div>
    </div>
  );
}

function PointsHistory({ data }: { data: PointsSummary }) {
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="tbl text-[13px]">
        <thead>
          <tr><th>Kampanye / tanggal</th><th>Donasi</th><th>Poin</th><th>Bukti</th></tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.donationId}>
              <td className="min-w-[180px]">
                <Link to={`/campaigns/${e.campaign.id}`} className={`[overflow-wrap:anywhere] ${link}`}>{e.campaign.title}</Link>
                <p className="text-slate-500">{date(e.earnedAt)}</p>
              </td>
              <td className="whitespace-nowrap align-middle">{rupiah(e.amount)}</td>
              <td className="whitespace-nowrap align-middle font-semibold text-emerald-700">+{num(e.points)}</td>
              <td className="whitespace-nowrap align-middle">
                <Link to={`/donations/${e.donationId}`} className={`inline-flex items-center gap-1 ${link}`}>
                  Lihat bukti <ExternalLink size={11} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dashboard poin comserve donatur (BFD-103). Poin hanya dari donasi berstatus PAID. */
export function PointsPage() {
  const q = useQuery({ queryKey: ["me", "points"], queryFn: fetchMyPoints });
  const data = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Poin Comserve"
        subtitle="Poin community service yang Anda kumpulkan dari donasi lunas."
        actions={<Link to="/my/donations" className="btn-secondary btn-sm">Donasi Saya</Link>}
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !data ? null : data.entries.length === 0 ? (
        <EmptyState title="Belum ada poin comserve">
          <p>Poin muncul setelah donasi Anda berstatus lunas. {data.rule}.</p>
          <Link to="/" className="btn-primary btn-sm mt-4">Jelajahi kampanye</Link>
        </EmptyState>
      ) : (
        <>
          <PointsSummaryCard data={data} />
          <Panel title="Riwayat Poin">
            <PointsHistory data={data} />
          </Panel>
        </>
      )}
    </div>
  );
}

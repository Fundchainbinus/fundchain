import { SDG_CATEGORIES } from "@fundchain/shared";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CampaignCard } from "../components/CampaignCard";
import {
  ChainBadge,
  DonationBadge,
  EmptyState,
  ErrorBox,
  IntegrityBadge,
  PageHeader,
  Spinner,
} from "../components/ui";
import { get } from "../lib/api";
import { dateTime, rupiah } from "../lib/format";
import type { CampaignSummary, MyDonation } from "../lib/types";

export function MyCampaignsPage() {
  const q = useQuery({
    queryKey: ["campaigns", "mine"],
    queryFn: () =>
      get<{ campaigns: CampaignSummary[] }>("/campaigns", {
        mine: "true",
        limit: 100,
      }),
  });

  const [selectedSdg, setSelectedSdg] = useState<string>("ALL");

  const campaigns = q.data?.campaigns || [];

  const sdgOptions = useMemo(() => {
    // Urutkan sesuai nomor SDG (1-17), bukan alfabet kode.
    const codes = new Set(campaigns.map((c) => c.sdgCategory));
    return SDG_CATEGORIES.filter((s) => codes.has(s.code));
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    if (selectedSdg === "ALL") return campaigns;
    return campaigns.filter((c) => c.sdgCategory === selectedSdg);
  }, [campaigns, selectedSdg]);

  return (
    <div>
      <PageHeader
        title="Campaign saya"
        subtitle="Semua campaign yang Anda buat, termasuk draft dan yang menunggu review."
        actions={
          <Link to="/campaigns/new" className="btn-primary">
            <Plus size={16} /> Buat campaign
          </Link>
        }
      />

      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : campaigns.length === 0 ? (
        <EmptyState title="Belum punya campaign">
          Mulai galang dana untuk proyek sosial Anda.
        </EmptyState>
      ) : (
        <div className="space-y-6 mt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label
              htmlFor="sdg-filter"
              className="text-sm font-medium text-slate-700"
            >
              Filter Kategori SDG:
            </label>
            <select
              id="sdg-filter"
              value={selectedSdg}
              onChange={(e) => setSelectedSdg(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy sm:w-64"
            >
              <option value="ALL">Semua SDG ({campaigns.length})</option>
              {sdgOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  SDG {s.number} · {s.label}
                </option>
              ))}
            </select>
          </div>

          {filteredCampaigns.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCampaigns.map((c) => (
                <div key={c.id} className="flex flex-col gap-2">
                  <CampaignCard c={c} />
                  {c.status === "REJECTED" && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                      Ditolak: {c.rejectionReason} —{" "}
                      <Link
                        to={`/campaigns/${c.id}/edit`}
                        className="font-semibold underline"
                      >
                        revisi
                      </Link>
                    </p>
                  )}
                  {c.status === "DRAFT" && (
                    <Link
                      to={`/campaigns/${c.id}/edit`}
                      className="text-xs font-medium text-navy hover:underline"
                    >
                      Lanjutkan draft →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-sm text-slate-500">
                Tidak ada campaign Anda dengan kategori SDG ini.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MyDonationsPage() {
  const q = useQuery({
    queryKey: ["me", "donations"],
    queryFn: () => get<MyDonation[]>("/me/donations"),
  });
  return (
    <div>
      <PageHeader
        title="Donasi saya"
        subtitle="Riwayat donasi beserta status pencatatan blockchain."
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data!.length === 0 ? (
        <EmptyState title="Belum ada donasi">
          <Link to="/" className="text-navy underline">
            Jelajahi campaign
          </Link>
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-3 py-3 font-medium">Nominal</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Blockchain</th>
                <th className="px-3 py-3 font-medium">Integritas</th>
                <th className="px-5 py-3">
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data!.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-3">
                    <Link
                      to={`/campaigns/${d.campaign.id}`}
                      className="font-medium hover:text-navy"
                    >
                      {d.campaign.title}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {dateTime(d.createdAt)}
                    </p>
                  </td>
                  <td className="px-3 py-3 font-medium">{rupiah(d.amount)}</td>
                  <td className="px-3 py-3">
                    <DonationBadge status={d.status} />
                  </td>
                  <td className="px-3 py-3">
                    <ChainBadge status={d.blockchainStatus} />
                  </td>
                  <td className="px-3 py-3">
                    {d.status === "PAID" ? (
                      <IntegrityBadge status={d.integrityStatus} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      to={
                        d.status === "PENDING"
                          ? `/donations/${d.id}/pay`
                          : `/donations/${d.id}`
                      }
                      className="text-xs font-medium text-navy hover:underline"
                    >
                      {d.status === "PENDING" ? "Bayar →" : "Bukti →"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

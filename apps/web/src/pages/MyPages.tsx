import { SDG_CATEGORIES } from "@fundchain/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChainBadge,
  DonationBadge,
  EmptyState,
  ErrorBox,
  FilterTabs,
  InfoNote,
  IntegrityBadge,
  PageHeader,
  Panel,
  Spinner,
} from "../components/ui";
import { get, post } from "../lib/api";
import { date, rupiah } from "../lib/format";
import { useMe } from "../lib/hooks";
import type { CampaignSummary, MyDonationsPage } from "../lib/types";
import { CampaignFormCard } from "./CampaignFormPage";
import { DisbursementHistory, DisburseFormCard } from "./DisbursePage";

const CAMPAIGN_TABS = [
  ["ALL", "Semua"],
  ["ACTIVE", "Active"],
  ["DRAFT", "Draft"],
  ["PENDING_REVIEW", "Pending"],
  ["REJECTED", "Rejected"],
  ["FROZEN", "Frozen"],
  ["COMPLETED", "Berakhir"],
] as const;

const STATUS_TEXT: Record<string, string> = { PENDING_REVIEW: "PENDING", COMPLETED: "BERAKHIR" };
const link = "text-ink hover:text-navy hover:underline";

/** Aksi per status, mengikuti kolom "Aksi" di Figma. Edit membuka form di sebelah kanan. */
function CampaignActions({ c, onEdit }: { c: CampaignSummary; onEdit: (id: string) => void }) {
  switch (c.status) {
    case "DRAFT":
      return <button className={link} onClick={() => onEdit(c.id)}>Edit draft</button>;
    case "PENDING_REVIEW":
      return <Link className={link} to={`/campaigns/${c.id}`}>Lihat pengajuan</Link>;
    case "REJECTED":
      return <button className={link} onClick={() => onEdit(c.id)}>Revisi</button>;
    default:
      return <Link className={link} to={`/campaigns/${c.id}`}>Detail</Link>;
  }
}

function ResubmitButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const submit = useMutation({ mutationFn: () => post(`/campaigns/${id}/submit`), onSuccess: () => qc.invalidateQueries() });
  return (
    <>
      <button className="btn-primary font-normal" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Mengajukan…" : "Ajukan ulang"}
      </button>
      {submit.error && <div className="w-full"><ErrorBox error={submit.error} /></div>}
    </>
  );
}

function MyCampaignsCard({ campaigns, onEdit }: { campaigns: CampaignSummary[]; onEdit: (id: string) => void }) {
  const [tab, setTab] = useState<string>("ALL");
  const [selectedSdg, setSelectedSdg] = useState<string>("ALL");
  const sdgOptions = useMemo(() => {
    // Urutkan sesuai nomor SDG (1-17), bukan alfabet kode.
    const codes = new Set(campaigns.map((c) => c.sdgCategory));
    return SDG_CATEGORIES.filter((s) => codes.has(s.code));
  }, [campaigns]);
  const bySdg = selectedSdg === "ALL" ? campaigns : campaigns.filter((c) => c.sdgCategory === selectedSdg);
  const shown = tab === "ALL" ? bySdg : bySdg.filter((c) => c.status === tab);
  const rejected = campaigns.filter((c) => c.status === "REJECTED");
  const frozen = campaigns.filter((c) => c.status === "FROZEN");

  return (
    <div className="card space-y-4 p-4">
      <FilterTabs
        value={tab}
        onChange={setTab}
        items={CAMPAIGN_TABS.filter(([v]) => v !== "COMPLETED" || campaigns.some((c) => c.status === v)).map(([v, l]) => ({
          value: v,
          label: l,
          count: v === "ALL" ? bySdg.length : bySdg.filter((c) => c.status === v).length,
        }))}
      />
      {sdgOptions.length > 1 && (
        <select aria-label="Filter kategori SDG" value={selectedSdg} onChange={(e) => setSelectedSdg(e.target.value)} className="input sm:w-64">
          <option value="ALL">Semua SDG ({campaigns.length})</option>
          {sdgOptions.map((s) => (
            <option key={s.code} value={s.code}>SDG {s.number} · {s.label}</option>
          ))}
        </select>
      )}
      {shown.length === 0 ? (
        <p className="text-[13px] text-slate-500">Tidak ada kampanye dengan filter ini.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="tbl text-[13px]">
            <thead>
              <tr><th>Kampanye</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className="min-w-[200px]">
                    <p className="[overflow-wrap:anywhere]">{c.title}</p>
                    <p>{["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(c.status) ? `Target ${rupiah(c.targetAmount)}` : `${rupiah(c.currentAmount)} / ${rupiah(c.targetAmount)}`}</p>
                  </td>
                  <td className="uppercase">{STATUS_TEXT[c.status] ?? c.status}</td>
                  <td><CampaignActions c={c} onEdit={onEdit} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rejected.map((c) => (
        <div key={c.id} className="space-y-4">
          <InfoNote tone="amber">{c.title} ditolak: {c.rejectionReason} Perbaiki proposal lalu ajukan ulang.</InfoNote>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary font-normal" onClick={() => onEdit(c.id)}>Revisi kampanye</button>
            <ResubmitButton id={c.id} />
          </div>
        </div>
      ))}
      {frozen.map((c) => (
        <div key={c.id} className="space-y-4">
          <InfoNote tone="red">
            {c.title} dibekukan karena hash bukti tidak cocok. Donasi dan pencairan dinonaktifkan; hubungi Admin BINUS.
          </InfoNote>
          <span className="btn cursor-not-allowed border border-line bg-[#ECEFF1] font-normal text-slate-500">Ajukan pencairan · Frozen</span>
        </div>
      ))}
    </div>
  );
}

/**
 * "Donasi Saya" per halaman (BUG-009 / #27). Tab = filter di server, jumlah per tab & total lunas
 * dari ringkasan DB, jadi tetap benar walau baru halaman pertama yang dimuat.
 */
function MyDonationsCard() {
  const [tab, setTab] = useState("ALL");
  const q = useInfiniteQuery({
    queryKey: ["me", "donations", "list", tab],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<MyDonationsPage>("/me/donations", { status: tab === "ALL" ? undefined : tab, cursor: pageParam, limit: 20 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const shown = q.data?.pages.flatMap((p) => p.donations) ?? [];
  const summary = q.data?.pages[0]?.summary;
  const counts = summary?.counts ?? { ALL: 0, PAID: 0, PENDING: 0, FAILED: 0 };
  if (counts.ALL === 0) {
    return (
      <p className="text-[13px] text-slate-500">
        Belum ada donasi. <Link to="/" className="text-navy underline">Jelajahi kampanye</Link>
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <FilterTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "ALL", label: "Semua", count: counts.ALL },
          { value: "PAID", label: "Paid", count: counts.PAID },
          { value: "PENDING", label: "Pending", count: counts.PENDING },
          { value: "FAILED", label: "Failed", count: counts.FAILED },
        ]}
      />
      <div className="overflow-x-auto rounded border border-line">
        <table className="tbl text-[13px]">
          <thead>
            <tr><th>Kampanye / tanggal</th><th>Nominal</th><th>Pembayaran / bukti</th></tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id}>
                <td className="min-w-[180px]">
                  <p className="[overflow-wrap:anywhere]">{d.campaign.title}</p>
                  <p>{date(d.donatedAt ?? d.createdAt)}</p>
                </td>
                <td className="whitespace-nowrap align-middle">{rupiah(d.amount)}</td>
                <td>
                  <p className="flex flex-wrap items-center gap-1">
                    <DonationBadge status={d.status} />
                    {d.status === "PAID" && (
                      <>· {d.integrityStatus === "PENDING" ? <ChainBadge status={d.blockchainStatus} /> : <IntegrityBadge status={d.integrityStatus} />}</>
                    )}
                  </p>
                  <Link to={d.status === "PENDING" ? `/donations/${d.id}/pay` : `/donations/${d.id}`} className={`inline-flex items-center gap-1 ${link}`}>
                    {d.status === "PENDING" ? "Bayar sekarang" : "Lihat bukti"} <ExternalLink size={11} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && (
        <button type="button" className="btn-secondary btn-sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
        </button>
      )}
      <p className="text-xs text-slate-500">
        Menampilkan {shown.length} dari {tab === "ALL" ? counts.ALL : counts[tab as keyof typeof counts]} donasi · Total donasi lunas Anda {rupiah(summary?.paidTotal ?? 0)}.
      </p>
    </div>
  );
}

/** Ruang Mahasiswa: susunan dua kolom seperti bagian "Ruang Mahasiswa" di Pengunjung.png. */
export function MyCampaignsPage() {
  const { me } = useMe();
  const campaignsQ = useQuery({
    queryKey: ["campaigns", "mine"],
    queryFn: () => get<{ campaigns: CampaignSummary[] }>("/campaigns", { mine: "true", limit: 100 }),
  });
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const campaigns = campaignsQ.data?.campaigns ?? [];
  const fundable = campaigns.filter((c) => ["ACTIVE", "COMPLETED", "FROZEN"].includes(c.status)).map((c) => ({ id: c.id, title: c.title }));
  const edit = (id: string) => {
    setEditingId(id);
    document.getElementById("form-kampanye")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <PageHeader title="Ruang Mahasiswa" subtitle={`${me?.name ?? "Mahasiswa"} · kelola kampanye, proposal, dan penggunaan dana Anda.`} />
        <span className="badge bg-[#FFF5E7] text-[#8A5A1E]">Student</span>
      </div>

      {/* Dua kolom independen: tinggi form di kanan tidak membuat celah kosong di kolom kiri. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <h2 className="section-title">Kampanye Saya</h2>
            {campaignsQ.isLoading ? (
              <Spinner />
            ) : campaignsQ.error ? (
              <ErrorBox error={campaignsQ.error} />
            ) : campaigns.length === 0 ? (
              <EmptyState title="Belum punya kampanye">Isi form Buat / Edit Kampanye untuk mulai menggalang dana.</EmptyState>
            ) : (
              <MyCampaignsCard campaigns={campaigns} onEdit={edit} />
            )}
          </section>
          <Panel title="Donasi Saya" aside={<Link to="/my/points" className="btn-secondary btn-sm">Poin Comserve</Link>}>
            <MyDonationsCard />
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <section id="form-kampanye" className="scroll-mt-28 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-title">Buat / Edit Kampanye</h2>
              {editingId && (
                <button className="btn-secondary btn-sm" onClick={() => setEditingId(undefined)}>
                  <Plus size={12} /> Kampanye baru
                </button>
              )}
            </div>
            <CampaignFormCard key={editingId ?? "new"} id={editingId} onCreated={setEditingId} />
          </section>
          <Panel title="Ajukan Pencairan Dana">
            {campaignsQ.isLoading ? <Spinner /> : <DisburseFormCard campaigns={fundable} />}
          </Panel>
        </div>
      </div>

      {fundable.length > 0 && (
        <Panel title="Riwayat Pencairan Saya">
          <DisbursementHistory campaigns={fundable} />
        </Panel>
      )}
    </div>
  );
}

export function MyDonationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Donasi Saya"
        subtitle="Riwayat donasi beserta status pencatatan blockchain."
        actions={<Link to="/my/points" className="btn-secondary btn-sm">Poin Comserve</Link>}
      />
      <Panel><MyDonationsCard /></Panel>
    </div>
  );
}

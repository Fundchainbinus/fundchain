import { LIMITS } from '@fundchain/shared';

/** Donasi minimal yang dibutuhkan untuk menghitung poin comserve. */
export interface PointsSource {
  id: string;
  amount: number;
  status: string;
  donatedAt: Date | null;
  createdAt: Date;
  campaign: { id: string; title: string };
}

export const POINT_RULE = `1 poin per Rp${LIMITS.RUPIAH_PER_POINT.toLocaleString('id-ID')} dari donasi berstatus PAID`;

/**
 * Poin comserve donatur (BFD-98). Dihitung saat dibaca dari donasi PAID, bukan disimpan,
 * supaya donasi yang di-refund (status REFUNDED) otomatis tidak lagi dihitung.
 */
export function computePoints(donations: PointsSource[]) {
  const entries = donations
    .filter((d) => d.status === 'PAID')
    .map((d) => ({
      donationId: d.id,
      campaign: { id: d.campaign.id, title: d.campaign.title },
      amount: d.amount,
      points: Math.floor(d.amount / LIMITS.RUPIAH_PER_POINT),
      earnedAt: (d.donatedAt ?? d.createdAt).toISOString(),
    }))
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  return { total: entries.reduce((sum, e) => sum + e.points, 0), entries, rule: POINT_RULE };
}

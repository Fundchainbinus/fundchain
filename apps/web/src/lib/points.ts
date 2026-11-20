import { ApiError, get } from './api';
import type { MyDonation, PointsSummary } from './types';

/**
 * Poin comserve untuk donatur (BFD-103).
 *
 * BE (BFD-98) belum punya endpoint. Kontrak usulan:
 *   GET /api/v1/me/points -> PointsSummary (tanpa field `source`)
 *
 * Selama endpoint belum ada (404), poin dihitung di FE dari /me/donations
 * dengan aturan sementara POINT_RULE. Aturan final ditentukan BE.
 */
export const RUPIAH_PER_POINT = 10_000;
export const POINT_RULE = `1 poin per Rp${RUPIAH_PER_POINT.toLocaleString('id-ID')} dari donasi berstatus PAID (aturan sementara)`;

export function pointsFromDonations(donations: MyDonation[]): PointsSummary {
  const entries = donations
    .filter((d) => d.status === 'PAID')
    .map((d) => ({
      donationId: d.id,
      campaign: { id: d.campaign.id, title: d.campaign.title },
      amount: d.amount,
      points: Math.floor(d.amount / RUPIAH_PER_POINT),
      earnedAt: d.donatedAt ?? d.createdAt,
    }))
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  return { total: entries.reduce((s, e) => s + e.points, 0), entries, rule: POINT_RULE, source: 'mock' };
}

export async function fetchMyPoints(): Promise<PointsSummary> {
  try {
    const res = await get<Omit<PointsSummary, 'source'>>('/me/points');
    return { ...res, source: 'api' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return pointsFromDonations(await get<MyDonation[]>('/me/donations'));
    }
    throw e;
  }
}

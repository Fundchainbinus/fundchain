import { describe, expect, it } from 'vitest';
import { publicDonorName, floorToSecond } from './common/format';
import { assertTransition, canTransition } from './modules/campaigns/campaign-status';
import { assertDisbursable, assertNoOpenMilestone, buildMilestones } from './modules/disbursements/disbursements.service';
import { computePoints } from './modules/donations/points';
import { signMockBody, verifyMockSignature } from './modules/payments/adapters/mock.adapter';

describe('state machine campaign', () => {
  it('mengizinkan transisi yang sah', () => {
    expect(canTransition('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransition('PENDING_REVIEW', 'ACTIVE')).toBe(true);
    expect(canTransition('PENDING_REVIEW', 'REJECTED')).toBe(true);
    expect(canTransition('REJECTED', 'PENDING_REVIEW')).toBe(true);
    expect(canTransition('ACTIVE', 'FROZEN')).toBe(true);
    expect(canTransition('FROZEN', 'ACTIVE')).toBe(true);
  });

  it('menolak transisi ilegal', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('REJECTED', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'PENDING_REVIEW')).toBe(false);
    expect(() => assertTransition('DRAFT', 'ACTIVE')).toThrow(/tidak bisa diubah/);
  });
});

describe('aturan pencairan', () => {
  it('FROZEN mengunci pencairan dengan kode CAMPAIGN_FROZEN', () => {
    expect(() => assertDisbursable('FROZEN')).toThrowError(expect.objectContaining({ code: 'CAMPAIGN_FROZEN' }));
  });

  it('hanya ACTIVE/COMPLETED yang eligible', () => {
    expect(() => assertDisbursable('ACTIVE')).not.toThrow();
    expect(() => assertDisbursable('COMPLETED')).not.toThrow();
    for (const s of ['DRAFT', 'PENDING_REVIEW', 'REJECTED']) {
      expect(() => assertDisbursable(s)).toThrowError(expect.objectContaining({ code: 'DISBURSEMENT_NOT_ELIGIBLE' }));
    }
  });
});

describe('milestone pencairan bertahap (BFD-97)', () => {
  const row = (id: string, status: string, day: number) => ({
    id,
    description: `Milestone ${id}`,
    amount: 100_000,
    status,
    requestedAt: new Date(`2026-11-${String(day).padStart(2, '0')}T00:00:00Z`),
    approvedAt: null,
    paidAt: null,
  });

  it('menolak pengajuan baru selama masih ada milestone berjalan', () => {
    expect(() => assertNoOpenMilestone(1)).toThrowError(expect.objectContaining({ code: 'DISBURSEMENT_IN_PROGRESS' }));
    expect(() => assertNoOpenMilestone(0)).not.toThrow();
  });

  it('mengurutkan tahap, melewati yang ditolak, dan menandai tahap berjalan', () => {
    const m = buildMilestones([row('c', 'REQUESTED', 5), row('a', 'PAID', 1), row('x', 'REJECTED', 2), row('b', 'PAID', 3)]);
    expect(m.steps.map((s) => [s.step, s.id])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
    expect(m.completed).toBe(2);
    expect(m.total).toBe(3);
    expect(m.current?.id).toBe('c');
    expect(m.canRequestNext).toBe(false);
  });

  it('boleh ajukan berikutnya kalau semua tahap selesai atau belum ada', () => {
    expect(buildMilestones([]).canRequestNext).toBe(true);
    expect(buildMilestones([row('a', 'PAID', 1), row('b', 'REJECTED', 2)]).canRequestNext).toBe(true);
  });
});

describe('poin comserve donatur (BFD-98)', () => {
  const d = (id: string, amount: number, status: string, at: string) => ({
    id,
    amount,
    status,
    donatedAt: new Date(at),
    createdAt: new Date(at),
    campaign: { id: 'c1', title: 'Kampanye' },
  });

  it('hanya donasi PAID yang dapat poin, dibulatkan ke bawah per Rp10.000', () => {
    const p = computePoints([
      d('a', 25_000, 'PAID', '2026-11-01T00:00:00Z'),
      d('b', 9_999, 'PAID', '2026-11-02T00:00:00Z'),
      d('c', 100_000, 'REFUNDED', '2026-11-03T00:00:00Z'),
      d('e', 50_000, 'PENDING', '2026-11-04T00:00:00Z'),
    ]);
    expect(p.total).toBe(2);
    expect(p.entries.map((e) => [e.donationId, e.points])).toEqual([['b', 0], ['a', 2]]);
    expect(p.rule).toMatch(/PAID/);
  });

  it('total nol kalau belum ada donasi', () => {
    expect(computePoints([])).toEqual(expect.objectContaining({ total: 0, entries: [] }));
  });
});

describe('signature webhook mock', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ order_id: 'abc', status: 'settlement', amount: 100000 });

  it('menerima signature yang benar', () => {
    expect(verifyMockSignature(body, signMockBody(body, secret), secret)).toBe(true);
  });

  it('menolak body yang diubah, secret salah, atau signature kosong', () => {
    const sig = signMockBody(body, secret);
    expect(verifyMockSignature(body.replace('100000', '900000'), sig, secret)).toBe(false);
    expect(verifyMockSignature(body, sig, 'secret-lain')).toBe(false);
    expect(verifyMockSignature(body, undefined, secret)).toBe(false);
    expect(verifyMockSignature(body, 'zz', secret)).toBe(false);
  });
});

describe('format', () => {
  it('nama donor dipseudonimkan untuk publik', () => {
    expect(publicDonorName('Budi Santoso', false)).toBe('Budi S.');
    expect(publicDonorName('Budi Santoso', true)).toBe('Anonim');
    expect(publicDonorName('Andi', false)).toBe('Andi');
  });

  it('waktu settlement dibulatkan ke detik', () => {
    expect(floorToSecond(new Date('2026-01-01T00:00:00.999Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

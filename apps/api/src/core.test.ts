import { describe, expect, it } from 'vitest';
import { publicDonorName, floorToSecond } from './common/format';
import { assertTransition, canTransition } from './modules/campaigns/campaign-status';
import { assertDisbursable } from './modules/disbursements/disbursements.service';
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

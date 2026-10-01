import { describe, expect, it } from 'vitest';
import { buildCanonicalPayload, hashDonation, hashPayload, toOnchainKey } from './canonical';

const base = {
  donationId: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
  integritySubjectId: 'STU-00042',
  amount: 100000,
  donatedAt: new Date('2026-09-28T12:53:20.789Z'),
};

describe('canonical payload', () => {
  it('membentuk format v1 dengan uuid lowercase dan detik unix', () => {
    expect(buildCanonicalPayload(base)).toBe(
      'v1|a1b2c3d4-e5f6-7890-abcd-ef1234567890|STU-00042|100000|1790600000',
    );
  });

  it('deterministik: input sama → hash sama (ms diabaikan)', () => {
    const a = hashDonation(base);
    const b = hashDonation({ ...base, donatedAt: new Date('2026-09-28T12:53:20.000Z') });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('avalanche: amount berubah → hash berbeda (skenario tamper)', () => {
    const original = hashDonation(base).hash;
    const tampered = hashDonation({ ...base, amount: 900000 }).hash;
    expect(tampered).not.toBe(original);
  });

  it('cocok dengan nilai keccak256 yang diketahui', () => {
    expect(hashPayload('')).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('onchain key tidak tergantung huruf besar/kecil', () => {
    expect(toOnchainKey(base.donationId)).toBe(toOnchainKey(base.donationId.toLowerCase()));
  });

  it('menolak amount desimal dan karakter pemisah', () => {
    expect(() => buildCanonicalPayload({ ...base, amount: 100.5 })).toThrow();
    expect(() => buildCanonicalPayload({ ...base, integritySubjectId: 'A|B' })).toThrow();
  });
});

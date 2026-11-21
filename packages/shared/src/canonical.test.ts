import { describe, expect, it } from 'vitest';
import {
  CANONICAL_VERSION,
  buildCanonicalPayload,
  hashDonation,
  hashPayload,
  toOnchainKey,
  type CanonicalInput,
} from './canonical';

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

/**
 * BFD-26 — TEST VECTOR BEKU (frozen). Lihat packages/shared/README.md.
 *
 * Format v1 sudah tertanam di semua hash on-chain (Sepolia); vector #2/#3 berasal dari
 * bukti cross-check Remix (docs/blockchain/remix-crosscheck-and-work-allocation.md).
 * JANGAN di-update supaya test hijau: kalau test ini gagal, berarti format canonical
 * berubah dan semua hash lama akan terbaca TAMPERED. Perubahan format wajib lewat versi baru (v2), bukan mengubah v1.
 */
const FROZEN_VECTORS: Array<{
  name: string;
  input: CanonicalInput;
  payload: string;
  hash: string;
  onchainKey: string;
}> = [
  {
    name: 'uuid huruf besar + milidetik dibuang',
    input: {
      donationId: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
      integritySubjectId: 'STU-00042',
      amount: 100000,
      donatedAt: new Date('2026-09-28T12:53:20.789Z'),
    },
    payload: 'v1|a1b2c3d4-e5f6-7890-abcd-ef1234567890|STU-00042|100000|1790600000',
    hash: '0x5bbb0fe554a82b0e941129cc588d7f36b5d099bd94a168210f5c84b17e1399be',
    onchainKey: '0x98c2d0d0dc0589b23b6f69fbee093a3dc1613579ed1dbe75a3eec3da944bac2b',
  },
  {
    name: 'cross-check Remix: original Rp50.000 (MATCH)',
    input: {
      donationId: '11111111-1111-4111-8111-111111111111',
      integritySubjectId: 'STU-00042',
      amount: 50000,
      donatedAt: new Date('2026-10-04T12:00:00Z'),
    },
    payload: 'v1|11111111-1111-4111-8111-111111111111|STU-00042|50000|1791115200',
    hash: '0x3a0adf185d40527d1996cd26f4613ef0d6f1af1211474bf84fcda19a6d058dd2',
    onchainKey: '0x31e5891f6803041a37cfae842c5bf47aa89df5130d6a8ba235cdd9041744763f',
  },
  {
    name: 'cross-check Remix: tampered Rp90.000 (MISMATCH)',
    input: {
      donationId: '11111111-1111-4111-8111-111111111111',
      integritySubjectId: 'STU-00042',
      amount: 90000,
      donatedAt: new Date('2026-10-04T12:00:00Z'),
    },
    payload: 'v1|11111111-1111-4111-8111-111111111111|STU-00042|90000|1791115200',
    hash: '0x39d0d37687d36d382c87699a9d97e23d97f0efc1cb3b476090e4e1750aea96b3',
    onchainKey: '0x31e5891f6803041a37cfae842c5bf47aa89df5130d6a8ba235cdd9041744763f',
  },
  {
    name: 'amount bigint > 2^53 + donatedAt number (ms) = 0',
    input: {
      donationId: '9f8e7d6c-5b4a-4321-8fed-cba987654321',
      integritySubjectId: 'DNR-7',
      amount: 12345678901234567890n,
      donatedAt: 0,
    },
    payload: 'v1|9f8e7d6c-5b4a-4321-8fed-cba987654321|DNR-7|12345678901234567890|0',
    hash: '0xc45dd3e9becfb85317c1da724fdb4503dc667a2884d234c1e265586036246675',
    onchainKey: '0xd255be87bc8cc0997f15c26a63efbbe072112075dedd7348c7b225a88ba94fde',
  },
];

describe('canonical v1: frozen test vectors (BFD-26)', () => {
  it('prefix versi runtime tetap "v1" (== versi 1 di spec)', () => {
    expect(CANONICAL_VERSION).toBe('v1');
  });

  for (const v of FROZEN_VECTORS) {
    it(v.name, () => {
      expect(buildCanonicalPayload(v.input)).toBe(v.payload);
      expect(hashPayload(v.payload)).toBe(v.hash);
      expect(hashDonation(v.input)).toEqual({ payload: v.payload, hash: v.hash });
      expect(toOnchainKey(v.input.donationId)).toBe(v.onchainKey);
    });
  }

  it('original vs tampered Remix: key sama, hash beda', () => {
    const [, original, tampered] = FROZEN_VECTORS;
    expect(original.onchainKey).toBe(tampered.onchainKey);
    expect(original.hash).not.toBe(tampered.hash);
  });
});

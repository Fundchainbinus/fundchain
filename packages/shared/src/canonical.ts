import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Canonical payload v1 — SATU-SATUNYA sumber format hash donasi.
 * Dipakai saat notarisasi (settlement) dan saat integrity check.
 *
 *   v1|donationId|integritySubjectId|amount|donatedAtUnix
 */
export const CANONICAL_VERSION = 'v1';

export interface CanonicalInput {
  donationId: string;
  /** Pseudonim stabil donor (mis. STU-00042) — jangan pakai email/nama. */
  integritySubjectId: string;
  /** Nominal rupiah, integer. */
  amount: number | bigint;
  /** Waktu settlement yang TERSIMPAN di DB (bukan now()). */
  donatedAt: Date | number;
}

export function toUnixSeconds(value: Date | number): number {
  const ms = value instanceof Date ? value.getTime() : value;
  return Math.floor(ms / 1000);
}

export function buildCanonicalPayload(input: CanonicalInput): string {
  const amount = typeof input.amount === 'bigint' ? input.amount : BigInt(input.amount);
  if (typeof input.amount === 'number' && !Number.isInteger(input.amount)) {
    throw new Error('amount harus integer');
  }
  for (const [field, value] of [
    ['donationId', input.donationId],
    ['integritySubjectId', input.integritySubjectId],
  ] as const) {
    if (!value || value.includes('|')) throw new Error(`${field} tidak valid`);
  }
  return [
    CANONICAL_VERSION,
    input.donationId.toLowerCase(),
    input.integritySubjectId,
    amount.toString(),
    toUnixSeconds(input.donatedAt).toString(),
  ].join('|');
}

/** keccak256(UTF8(payload)) → 0x-prefixed bytes32 hex. */
export function hashPayload(payload: string): string {
  return keccak256(toUtf8Bytes(payload));
}

export function hashDonation(input: CanonicalInput): { payload: string; hash: string } {
  const payload = buildCanonicalPayload(input);
  return { payload, hash: hashPayload(payload) };
}

/** Key bytes32 di contract: keccak256(UTF8(lowercase(uuid))). Disimpan di DB, tidak di-reverse. */
export function toOnchainKey(donationId: string): string {
  return keccak256(toUtf8Bytes(donationId.toLowerCase()));
}

export const ZERO_HASH = '0x' + '0'.repeat(64);

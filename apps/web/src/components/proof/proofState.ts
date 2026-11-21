import type { BlockchainStatus, DonationStatus } from '@fundchain/shared';
import type { DonationProof } from '../../lib/types';

/** Status notarisasi yang masih bisa berubah sendiri: layak dipantau. */
export const PENDING_CHAIN: readonly BlockchainStatus[] = ['QUEUED', 'SUBMITTED', 'RETRYING'];

/** Polling detail donasi hanya selama donasi PAID dan notarisasinya belum final. */
export function shouldPollDonation(status: DonationStatus | undefined, chain: BlockchainStatus | null | undefined) {
  return status === 'PAID' && !!chain && PENDING_CHAIN.includes(chain);
}

export type ProofVerdict =
  /** Permintaan /proof gagal (jaringan, 429, akses). */
  | { kind: 'request-error'; message: string }
  /** Donasi belum lunas: tidak akan dinotarisasi. */
  | { kind: 'not-paid' }
  /** Lunas tapi transaksi notarisasi belum terkonfirmasi. */
  | { kind: 'pending'; status: BlockchainStatus | null }
  /** Notarisasi gagal permanen. */
  | { kind: 'notarize-failed' }
  /** CONFIRMED tapi RPC tidak bisa dibaca. */
  | { kind: 'rpc-error'; message: string }
  /** CONFIRMED di DB tapi kontrak tidak menyimpan hash untuk donasi ini. */
  | { kind: 'missing-onchain' }
  | { kind: 'match' }
  | { kind: 'mismatch' };

/**
 * Satu-satunya sumber kesimpulan bukti. Vonis cocok/tidak memakai `match` dari server
 * (hash dihitung ulang dari data DB saat ini vs hash on-chain), BUKAN hashDb === hashOnChain:
 * bila data DB diubah, hashDb lama masih sama dengan hash on-chain padahal datanya sudah dimanipulasi.
 */
export function deriveVerdict(
  donationStatus: DonationStatus,
  proof: DonationProof | undefined,
  requestError: unknown,
): ProofVerdict | null {
  if (donationStatus !== 'PAID') return { kind: 'not-paid' };
  if (!proof) {
    if (requestError) return { kind: 'request-error', message: requestError instanceof Error ? requestError.message : String(requestError) };
    return null; // masih memuat
  }
  const s = proof.notarizationStatus;
  if (s === 'FAILED') return { kind: 'notarize-failed' };
  if (s !== 'CONFIRMED') return { kind: 'pending', status: s };
  if (proof.onChainError) return { kind: 'rpc-error', message: proof.onChainError };
  if (!proof.hashOnChain) return { kind: 'missing-onchain' };
  if (proof.match === true) return { kind: 'match' };
  if (proof.match === false) return { kind: 'mismatch' };
  // CONFIRMED + hash on-chain ada, tapi currentHash tidak bisa dihitung: anggap tidak terverifikasi.
  return { kind: 'missing-onchain' };
}

export const RPC_ERROR_TEXT = 'Tidak bisa membaca blockchain saat ini. Coba cek ulang beberapa saat lagi.';

/** Ringkasan vonis sebagai teks (dipakai juga di versi cetak, yang tidak mencetak warna latar). */
export function verdictText(v: ProofVerdict | null): string {
  if (!v) return 'Memeriksa blockchain…';
  switch (v.kind) {
    case 'request-error':
      return `Gagal memuat bukti: ${v.message}`;
    case 'not-paid':
      return 'Donasi belum lunas, sehingga tidak dicatat ke blockchain.';
    case 'pending':
      return 'Belum dinotarisasi: transaksi pencatatan ke blockchain belum terkonfirmasi.';
    case 'notarize-failed':
      return 'Notarisasi gagal: hash belum tercatat di blockchain.';
    case 'rpc-error':
      return RPC_ERROR_TEXT;
    case 'missing-onchain':
      return 'Hash untuk donasi ini tidak ditemukan di smart contract.';
    case 'match':
      return 'COCOK: hash dari data saat ini sama dengan hash di blockchain.';
    case 'mismatch':
      return 'TAMPERED: hash dari data saat ini TIDAK sama dengan hash di blockchain. Data donasi telah diubah.';
  }
}

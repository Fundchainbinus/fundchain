/**
 * BFD-49: klasifikasi error saat relayer mengirim tx notarize().
 *
 * Kategori disimpan sebagai prefix `lastError` ("[NONCE_TOO_LOW] nonce too low ...") supaya:
 *  - admin melihat penyebab di halaman Integritas tanpa membaca log,
 *  - tick berikutnya (bisa instance serverless lain, tanpa memori bersama) tahu perbaikan apa yang dipakai.
 *
 * Sumber: kode error ethers v6 (INSUFFICIENT_FUNDS, NONCE_EXPIRED, REPLACEMENT_UNDERPRICED) + pencocokan pesan
 * node (geth/Hardhat/Besu/Nethermind) karena tidak semua error RPC dipetakan ethers ke kode khusus.
 */
export type RelayerErrorClass =
  | 'INSUFFICIENT_FUNDS'
  | 'NONCE_TOO_LOW'
  | 'NONCE_CONFLICT'
  | 'REPLACEMENT_UNDERPRICED'
  | 'ALREADY_KNOWN'
  | 'GAS_UNDERPRICED'
  | 'GAS_TOO_LOW';

export interface RelayerErrorHandling {
  /** Ambil nonce baru dari provider (blockTag 'pending') sebelum kirim ulang. */
  freshNonce: boolean;
  /** Naikkan maxFeePerGas/maxPriorityFeePerGas (atau gasPrice) sebelum kirim ulang. */
  bumpFee: boolean;
  /** Estimasi ulang gas limit dengan headroom sebelum kirim ulang. */
  bumpGasLimit: boolean;
  /** Langsung FAILED tanpa menghabiskan jatah retry (butuh tindakan manusia, mis. isi saldo). */
  terminal: boolean;
}

/**
 * Penanganan per kategori.
 * - Nonce: penyebab umum di serverless = dua instance mengirim tx berbeda dengan nonce yang sama.
 * - REPLACEMENT_UNDERPRICED: nonce yang sama sudah dipakai tx lain di mempool. Diperlakukan sebagai konflik nonce
 *   (nonce baru), BUKAN menaikkan fee di nonce yang sama — itu akan menggusur tx donasi lain yang sedang pending.
 * - ALREADY_KNOWN: tx identik sudah ada di mempool (sudah terkirim). Tidak dikirim ulang; job dibiarkan SUBMITTED
 *   dan diselesaikan recoverStuck() (isNotarized → CONFIRMED, atau dropped → dikirim ulang).
 */
export const RELAYER_ERROR_HANDLING: Record<RelayerErrorClass, RelayerErrorHandling> = {
  INSUFFICIENT_FUNDS: { freshNonce: false, bumpFee: false, bumpGasLimit: false, terminal: true },
  NONCE_TOO_LOW: { freshNonce: true, bumpFee: false, bumpGasLimit: false, terminal: false },
  NONCE_CONFLICT: { freshNonce: true, bumpFee: false, bumpGasLimit: false, terminal: false },
  REPLACEMENT_UNDERPRICED: { freshNonce: true, bumpFee: false, bumpGasLimit: false, terminal: false },
  ALREADY_KNOWN: { freshNonce: false, bumpFee: false, bumpGasLimit: false, terminal: false },
  GAS_UNDERPRICED: { freshNonce: false, bumpFee: true, bumpGasLimit: false, terminal: false },
  GAS_TOO_LOW: { freshNonce: false, bumpFee: false, bumpGasLimit: true, terminal: false },
};

const MESSAGE_PATTERNS: [RelayerErrorClass, RegExp][] = [
  ['INSUFFICIENT_FUNDS', /insufficient funds|insufficient balance|sender doesn't have enough funds/i],
  ['REPLACEMENT_UNDERPRICED', /replacement (transaction )?underpriced|replacement fee too low/i],
  ['ALREADY_KNOWN', /already known|known transaction|already imported|transaction already in (the )?(mem)?pool/i],
  ['NONCE_TOO_LOW', /nonce too low|nonce has already been used|nonce is too low|oldnonce|nonce_too_low/i],
  ['NONCE_CONFLICT', /nonce too high|nonce gap|noncegap|too far in (the )?future|nonce conflict|invalid nonce|incorrect nonce/i],
  [
    'GAS_UNDERPRICED',
    /transaction underpriced|max fee per gas less than block base fee|fee cap less than block base fee|gas price too low|feetoolow|underpriced/i,
  ],
  ['GAS_TOO_LOW', /intrinsic gas too low|gas too low|gas limit too low|out of gas|exceeds block gas limit/i],
];

const CODE_MAP: Record<string, RelayerErrorClass> = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  NONCE_EXPIRED: 'NONCE_TOO_LOW',
  REPLACEMENT_UNDERPRICED: 'REPLACEMENT_UNDERPRICED',
};

/** Kumpulkan pesan error termasuk yang bersarang (ethers membungkus error JSON-RPC asli di info.error / error). */
function collectMessages(error: unknown, depth = 0, out: string[] = []): string[] {
  if (!error || depth > 4) return out;
  if (typeof error === 'string') {
    out.push(error);
    return out;
  }
  if (typeof error !== 'object') return out;
  const e = error as Record<string, unknown>;
  for (const key of ['shortMessage', 'message', 'reason']) {
    if (typeof e[key] === 'string') out.push(e[key] as string);
  }
  collectMessages(e.error, depth + 1, out);
  collectMessages((e.info as Record<string, unknown> | undefined)?.error, depth + 1, out);
  collectMessages(e.cause, depth + 1, out);
  return out;
}

function collectCodes(error: unknown, depth = 0, out: string[] = []): string[] {
  if (!error || typeof error !== 'object' || depth > 4) return out;
  const e = error as Record<string, unknown>;
  if (typeof e.code === 'string') out.push(e.code);
  collectCodes(e.error, depth + 1, out);
  collectCodes(e.cause, depth + 1, out);
  return out;
}

/** null = bukan error relayer yang dikenali (mis. RPC timeout biasa) → retry backoff standar. */
export function classifyRelayerError(error: unknown): RelayerErrorClass | null {
  for (const code of collectCodes(error)) {
    if (CODE_MAP[code]) return CODE_MAP[code];
  }
  const text = collectMessages(error).join(' | ');
  if (!text) return null;
  for (const [cls, pattern] of MESSAGE_PATTERNS) {
    if (pattern.test(text)) return cls;
  }
  return null;
}

/** "[NONCE_TOO_LOW] nonce too low" → 'NONCE_TOO_LOW'. */
export function errorClassFromLastError(lastError: string | null | undefined): RelayerErrorClass | null {
  const m = /^\[([A-Z_]+)\]/.exec(lastError ?? '');
  if (!m) return null;
  return (m[1] in RELAYER_ERROR_HANDLING ? m[1] : null) as RelayerErrorClass | null;
}

export function formatRelayerError(cls: RelayerErrorClass | null, message: string): string {
  return cls ? `[${cls}] ${message}` : message;
}

/** Pesan singkat yang aman disimpan: shortMessage ethers lebih ringkas dari message (yang memuat seluruh payload). */
export function relayerErrorMessage(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown } | null;
  if (e && typeof e.shortMessage === 'string' && e.shortMessage) return e.shortMessage;
  if (e && typeof e.message === 'string') return e.message;
  return String(error);
}

export interface FeeData {
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  gasPrice: bigint | null;
}

export type FeeOverrides = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint };

/** Kenaikan fee per perbaikan: 25% (> 10–12.5% minimum aturan replacement geth). */
export const FEE_BUMP_PERCENT = 125n;

/**
 * Fee baru = max(fee jaringan saat ini, fee percobaan sebelumnya) × 1.25.
 * EIP-1559 bila provider memberi maxFeePerGas; selain itu legacy gasPrice. null = provider tidak memberi data fee.
 */
export function bumpFees(current: FeeData, previous?: Partial<Record<'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice', bigint>>): FeeOverrides | null {
  const bump = (a: bigint | null | undefined, b: bigint | null | undefined) => {
    const base = (a ?? 0n) > (b ?? 0n) ? (a ?? 0n) : (b ?? 0n);
    return (base * FEE_BUMP_PERCENT + 99n) / 100n;
  };
  if (current.maxFeePerGas != null) {
    const maxPriorityFeePerGas = bump(current.maxPriorityFeePerGas, previous?.maxPriorityFeePerGas);
    let maxFeePerGas = bump(current.maxFeePerGas, previous?.maxFeePerGas);
    if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
    return { maxFeePerGas, maxPriorityFeePerGas };
  }
  if (current.gasPrice != null) return { gasPrice: bump(current.gasPrice, previous?.gasPrice) };
  return null;
}

import * as path from 'node:path';

/** Root repo (e2e/helpers → ../..). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const E2E_ROOT = path.resolve(__dirname, '..');
export const EVIDENCE_DIR = path.join(E2E_ROOT, 'evidence-out');

export const WEB_URL = process.env.E2E_WEB_URL || 'http://localhost:5173';
export const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:3000/api/v1';

/** Secret webhook mock yang SAMA dengan env API di workflow (nilai CI sekali pakai). */
export const MOCK_WEBHOOK_SECRET = process.env.MOCK_WEBHOOK_SECRET || 'dev-mock-webhook-secret';

export const SAMPLE_PROPOSAL = path.join(REPO_ROOT, 'samples', 'proposal-contoh.pdf');
export const SAMPLE_MILESTONE = path.join(REPO_ROOT, 'samples', 'bukti-milestone-contoh.pdf');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostOf(name: string, raw: string | undefined): string {
  if (!raw) return 'localhost';
  try {
    return new URL(raw).hostname;
  } catch {
    throw new Error(`[e2e] ${name} bukan URL valid.`);
  }
}

/**
 * Pengaman harness: menolak jalan bila web/API/DB/RPC bukan loopback, bila apps/api/.env dipakai
 * (menunjuk DB production), atau bila provider pembayaran bukan mock.
 */
export function assertLocalStack(e: NodeJS.ProcessEnv = process.env) {
  const targets: [string, string | undefined][] = [
    ['E2E_WEB_URL', WEB_URL],
    ['E2E_API_URL', API_URL],
    ['DATABASE_URL', e.DATABASE_URL],
    ['BLOCKCHAIN_RPC_URL', e.BLOCKCHAIN_RPC_URL],
  ];
  for (const [name, value] of targets) {
    if (value === undefined && name !== 'E2E_WEB_URL' && name !== 'E2E_API_URL') continue;
    const host = hostOf(name, value);
    if (!LOOPBACK.has(host)) throw new Error(`[e2e] ${name} harus loopback, bukan ${host}. Harness tidak boleh menyentuh stack remote.`);
  }
  if (e.PAYMENT_PROVIDER && e.PAYMENT_PROVIDER !== 'mock') throw new Error('[e2e] PAYMENT_PROVIDER wajib mock.');
  if (e.CHAIN_ID && e.CHAIN_ID !== '31337') throw new Error('[e2e] CHAIN_ID wajib 31337 (Hardhat lokal).');
  if (e.NODE_ENV === 'production' || e.VERCEL) throw new Error('[e2e] Ditolak: environment production.');
}

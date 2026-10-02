import * as fs from 'node:fs';
import * as path from 'node:path';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? n : fallback;
}

/** Konfigurasi dibaca dari process.env (di-load oleh ConfigModule dari apps/api/.env). */
export function env() {
  const e = process.env;
  return {
    port: int(e.PORT, 3000),
    webUrl: e.WEB_URL || 'http://localhost:5173',
    isProduction: e.NODE_ENV === 'production',
    demoMode: bool(e.DEMO_MODE, true),
    devTools: bool(e.ENABLE_DEV_TOOLS, true),
    paymentProvider: (e.PAYMENT_PROVIDER || 'mock') as 'mock' | 'pakasir',
    mockWebhookSecret: e.MOCK_WEBHOOK_SECRET || 'dev-mock-webhook-secret',
    pakasir: {
      project: e.PAKASIR_PROJECT || '',
      apiKey: e.PAKASIR_API_KEY || '',
      baseUrl: (e.PAKASIR_BASE_URL || 'https://app.pakasir.com').replace(/\/$/, ''),
    },
    uploadDir: path.resolve(process.cwd(), e.UPLOAD_DIR || './uploads'),
    storageDriver: (e.STORAGE_DRIVER || 'local') as 'local' | 'database',
    /** Secret untuk endpoint cron (Vercel Cron mengirim Authorization: Bearer <CRON_SECRET>). */
    cronSecret: e.CRON_SECRET || '',
    blockchain: {
      network: e.BLOCKCHAIN_NETWORK || 'localhost',
      rpcUrl: e.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545',
      chainId: int(e.CHAIN_ID, 31337),
      contractAddress: e.CONTRACT_ADDRESS || '',
      relayerPrivateKey: e.RELAYER_PRIVATE_KEY || '',
      confirmations: int(e.BLOCKCHAIN_CONFIRMATIONS, 1),
    },
    worker: {
      enabled: bool(e.WORKER_ENABLED, true),
      /** interval = polling terus (server biasa); on-demand = dipicu request/cron (serverless). */
      mode: (e.WORKER_MODE || 'interval') as 'interval' | 'on-demand',
      pollMs: int(e.WORKER_POLL_MS, 2000),
    },
  };
}

export type Env = ReturnType<typeof env>;

/** Cari file deployment Hardhat (contracts/deployments/<network>.json). */
export function readDeploymentFile(network: string): { address: string; chainId: number } | null {
  const candidates = [
    path.resolve(process.cwd(), '../../contracts/deployments', `${network}.json`),
    path.resolve(__dirname, '../../../../contracts/deployments', `${network}.json`),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* abaikan file rusak */
    }
  }
  return null;
}

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
    googleClientId: e.GOOGLE_CLIENT_ID || '',
    /** Email (dipisah koma) yang otomatis menjadi ADMIN saat login Google. */
    adminEmails: (e.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    devTools: bool(e.ENABLE_DEV_TOOLS, true),
    paymentProvider: (e.PAYMENT_PROVIDER || 'mock') as 'mock' | 'pakasir' | 'sakurupiah',
    mockWebhookSecret: e.MOCK_WEBHOOK_SECRET || 'dev-mock-webhook-secret',
    pakasir: {
      project: e.PAKASIR_PROJECT || '',
      apiKey: e.PAKASIR_API_KEY || '',
      baseUrl: (e.PAKASIR_BASE_URL || 'https://app.pakasir.com').replace(/\/$/, ''),
    },
    /** Sakurupiah (D-002). SAKURUPIAH_SANDBOX=true → endpoint api-sanbox (ejaan resmi Sakurupiah). */
    sakurupiah: {
      apiId: e.SAKURUPIAH_API_ID || '',
      apiKey: e.SAKURUPIAH_API_KEY || '',
      baseUrl: (
        e.SAKURUPIAH_BASE_URL || (bool(e.SAKURUPIAH_SANDBOX, true) ? 'https://sakurupiah.id/api-sanbox' : 'https://sakurupiah.id/api')
      ).replace(/\/$/, ''),
      method: e.SAKURUPIAH_METHOD || 'QRIS',
      /** URL publik webhook, mis. https://fundchain-api.vercel.app/api/v1/webhooks/payment */
      callbackUrl: e.SAKURUPIAH_CALLBACK_URL || '',
      /** Field phone wajib di Sakurupiah; FundChain tidak menyimpan HP donatur, jadi dipakai nomor merchant. */
      phone: e.SAKURUPIAH_PHONE || '',
      /** merchant = fee ditanggung FundChain (total = nominal donasi); customer = donatur bayar fee. */
      feeBy: (e.SAKURUPIAH_FEE_BY === 'customer' ? 'customer' : 'merchant') as 'merchant' | 'customer',
    },
    /** Secret untuk endpoint cron (Vercel Cron mengirim Authorization: Bearer <CRON_SECRET>). */
    cronSecret: e.CRON_SECRET || '',
    blockchain: {
      network: e.BLOCKCHAIN_NETWORK || 'localhost',
      rpcUrl: e.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545',
      chainId: int(e.CHAIN_ID, 31337),
      contractAddress: e.CONTRACT_ADDRESS || '',
      relayerPrivateKey: e.RELAYER_PRIVATE_KEY || '',
      /**
       * BFD-48: jumlah konfirmasi blok sebelum notarisasi dianggap CONFIRMED (minimal 1).
       * Default 2; khusus Hardhat lokal (CHAIN_ID=31337, automine 1 blok per tx) default 1
       * karena blok kedua baru muncul saat ada tx lain. Nilai eksplisit selalu dipakai.
       */
      confirmations: Math.max(1, Math.floor(int(e.BLOCKCHAIN_CONFIRMATIONS, int(e.CHAIN_ID, 31337) === 31337 ? 1 : 2))),
      /** Batas tunggu receipt per tx; lewat batas, konfirmasi diteruskan recoverStuck() supaya antrean tidak terkunci. */
      confirmWaitMs: int(e.BLOCKCHAIN_CONFIRM_WAIT_MS, 45_000),
      /** Saldo relayer di bawah ini (ETH) dianggap rendah: warning di log worker & flag lowBalance di admin. */
      relayerMinBalanceEth: (() => {
        const v = (e.RELAYER_MIN_BALANCE_ETH || '').trim();
        return /^\d+(\.\d{1,18})?$/.test(v) ? v : '0.02';
      })(),
    },
    alerts: {
      /** Discord webhook untuk alert operasional (kosong = hanya log). */
      webhookUrl: e.ALERT_WEBHOOK_URL || '',
      /** Notarisasi yang belum CONFIRMED lebih lama dari ini sejak masuk antrean dianggap macet. */
      stuckTxMs: int(e.STUCK_TX_ALERT_MS, 10 * 60 * 1000),
    },
    integrity: {
      /** Hash checker otomatis: donasi yang terakhir dicek lebih lama dari ini akan dicek ulang. */
      checkIntervalMs: int(e.INTEGRITY_CHECK_INTERVAL_MS, 60 * 60 * 1000),
      /** Maksimal donasi per putaran (menjaga durasi fungsi serverless & kuota RPC). */
      batchSize: int(e.INTEGRITY_CHECK_BATCH, 50),
      /** Campaign FROZEN yang tidak dipulihkan disembunyikan (soft-delete) setelah N hari. */
      frozenRetentionDays: int(e.FROZEN_SOFT_DELETE_DAYS, 30),
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

/** Production = NODE_ENV=production atau berjalan di Vercel (VERCEL selalu di-set oleh platform). */
export function isProductionLike(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.NODE_ENV === 'production' || !!e.VERCEL;
}

/**
 * BFD-25: peringatan bila secret penting jatuh ke nilai default di production.
 * Hanya peringatan — perilaku fallback tidak diubah supaya deploy lama tidak mendadak mati.
 */
export function insecureDefaultWarnings(e: NodeJS.ProcessEnv = process.env): string[] {
  if (!isProductionLike(e)) return [];
  const warnings: string[] = [];
  if (!e.SESSION_SECRET) {
    warnings.push(
      'SESSION_SECRET tidak di-set — token sesi ditandatangani dengan secret turunan DATABASE_URL. Set SESSION_SECRET acak (>= 32 byte) di environment production.',
    );
  }
  if (!e.MOCK_WEBHOOK_SECRET) {
    warnings.push(
      'MOCK_WEBHOOK_SECRET tidak di-set — webhook mock memakai secret default publik "dev-mock-webhook-secret". Set secret acak, atau pakai PAYMENT_PROVIDER=sakurupiah.',
    );
  }
  return warnings;
}

/**
 * BFD-12: DEMO_MODE=true membuka GET /auth/demo (login sebagai user demo hasil seed).
 * Default mati. Di production/Vercel tetap mati kecuali DEMO_MODE_ALLOW_PRODUCTION=true juga di-set.
 */
export function demoModeEnabled(e: NodeJS.ProcessEnv = process.env): boolean {
  if (!bool(e.DEMO_MODE, false)) return false;
  return !isProductionLike(e) || bool(e.DEMO_MODE_ALLOW_PRODUCTION, false);
}

/** BFD-44: dokumentasi OpenAPI aktif di non-production, atau bila ENABLE_API_DOCS=true. */
export function apiDocsEnabled(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.NODE_ENV !== 'production' || bool(e.ENABLE_API_DOCS, false);
}

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

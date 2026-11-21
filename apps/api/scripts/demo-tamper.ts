/**
 * SIMULASI SERANGAN — mengubah nominal donasi LANGSUNG di database, seolah-olah
 * ada orang dalam yang memanipulasi data. Sengaja tidak lewat API & tidak tercatat di audit log.
 *
 *   ALLOW_DEMO_TAMPER=true pnpm demo:tamper <donationId> <nominalBaru>
 *   ALLOW_DEMO_TAMPER=true pnpm demo:tamper --latest 900000
 *   ALLOW_DEMO_TAMPER=true pnpm demo:tamper --latest 900000 --check   ← langsung jalankan integrity check (untuk demo)
 *   ALLOW_DEMO_TAMPER=true pnpm --silent demo:tamper --latest 900000 --json
 *       ← stdout HANYA satu baris JSON { status, currentHash, onChainHash, campaignFrozen } (implies --check)
 *
 * Pengaman (BFD-53/105) — script menolak jalan kecuali SEMUA terpenuhi, dicek sebelum query apa pun:
 *   1. ALLOW_DEMO_TAMPER=true di environment shell (nilai di apps/api/.env diabaikan)
 *   2. Bukan production: NODE_ENV != production dan bukan di Vercel (VERCEL kosong)
 *   3. DATABASE_URL menunjuk host lokal (localhost/127.0.0.1/::1/host.docker.internal), ATAU
 *      DEMO_TAMPER_DB_ALLOW (di shell) berisi "<user>@<host>" yang sama persis dengan DATABASE_URL.
 *      (Pooler Supabase dipakai bersama banyak project; project dibedakan oleh username
 *      postgres.<PROJECT_REF>, jadi host saja tidak cukup untuk membedakan DB demo dan production.)
 *
 * Tanpa --check: hash checker otomatis (worker/cron) atau Admin → Integritas yang akan mendeteksi.
 * Hasil yang diharapkan: TAMPERED → campaign FROZEN → pencairan terkunci.
 * Untuk reset setelah demo, jalankan lagi dengan nominal asli + --check, lalu unfreeze dari Admin.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaClient } from '@prisma/client';

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

export interface TamperGuardInput {
  ALLOW_DEMO_TAMPER?: string;
  NODE_ENV?: string;
  VERCEL?: string;
  DATABASE_URL?: string;
  DEMO_TAMPER_DB_ALLOW?: string;
}

/** null = boleh jalan; string = alasan ditolak (tidak pernah memuat URL / password database). */
export function demoTamperGuard(e: TamperGuardInput): string | null {
  if ((e.ALLOW_DEMO_TAMPER ?? '').trim().toLowerCase() !== 'true') {
    return 'ALLOW_DEMO_TAMPER=true wajib di-set. Script ini memanipulasi data donasi langsung di database.';
  }
  if (e.NODE_ENV === 'production' || e.VERCEL) {
    return 'Ditolak: environment production (NODE_ENV=production atau VERCEL).';
  }
  let url: URL;
  try {
    url = new URL(e.DATABASE_URL ?? '');
  } catch {
    return 'DATABASE_URL kosong atau bukan URL yang valid.';
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return 'DATABASE_URL harus PostgreSQL.';
  const host = url.hostname.toLowerCase();
  if (LOCAL_DB_HOSTS.has(host)) return null;
  const identity = `${decodeURIComponent(url.username)}@${host}`;
  const allowed = (e.DEMO_TAMPER_DB_ALLOW ?? '').trim().toLowerCase();
  if (allowed && allowed === identity.toLowerCase()) return null;
  return (
    `Ditolak: database remote (${host}) tidak ada di allowlist. Pakai database demo lokal, atau set ` +
    'DEMO_TAMPER_DB_ALLOW="<user>@<host>" persis sama dengan DATABASE_URL database DEMO (jangan production).'
  );
}

/** Muat apps/api/.env tanpa menimpa variabel yang sudah di-set — sama seperti Prisma saat client dibuat. */
function loadDotEnv() {
  const file = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

export interface TamperJsonResult {
  status: 'VERIFIED' | 'TAMPERED';
  currentHash: string;
  onChainHash: string;
  campaignFrozen: boolean;
}

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

async function runIntegrityCheck(prisma: PrismaClient, donationId: string, json: boolean): Promise<TamperJsonResult> {
  // Worker tidak perlu jalan di proses script ini.
  process.env.WORKER_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { IntegrityService } = await import('../src/modules/integrity/integrity.service');
  // --json: logger Nest mati supaya stdout hanya berisi JSON.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: json ? false : ['error', 'warn'] });
  try {
    const result = await app.get(IntegrityService).verifyDonation(donationId, null, { source: 'DEMO' });
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId } });
    const out: TamperJsonResult = {
      status: result.status,
      currentHash: result.currentHash,
      onChainHash: result.onChainHash,
      campaignFrozen: campaign.status === 'FROZEN',
    };
    if (!json) {
      console.log('');
      console.log('🔍 Integrity check');
      console.log(`   Hash dari DB sekarang : ${result.currentHash}`);
      console.log(`   Hash di blockchain    : ${result.onChainHash}`);
      console.log(`   Status donasi         : ${result.status}`);
      console.log(`   Status campaign       : ${campaign.status}${campaign.frozenReason ? ` (${campaign.frozenReason})` : ''}`);
      if (result.status === 'TAMPERED') console.log('🚫 Manipulasi terdeteksi — campaign dibekukan, pencairan dana terkunci.');
      else console.log('✅ Data cocok dengan blockchain.');
    }
    return out;
  } finally {
    await app.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const check = json || args.includes('--check');
  // Pesan manusia ke stderr saat --json, supaya stdout tetap JSON murni.
  const say = json ? (...m: unknown[]) => console.error(...m) : (...m: unknown[]) => console.log(...m);
  const [target, amountArg] = args.filter((a) => a !== '--check' && a !== '--json');
  if (!target || !amountArg) {
    console.error('Pemakaian: ALLOW_DEMO_TAMPER=true pnpm demo:tamper <donationId|--latest> <nominalBaru> [--check] [--json]');
    process.exitCode = 1;
    return;
  }

  // Pengaman dicek SEBELUM PrismaClient dibuat, atas DATABASE_URL yang akan benar-benar dipakai Prisma.
  // Flag izin dibaca dari shell SEBELUM .env dimuat: file .env tidak boleh mengizinkan dirinya sendiri.
  const { ALLOW_DEMO_TAMPER, DEMO_TAMPER_DB_ALLOW } = process.env;
  loadDotEnv();
  const refused = demoTamperGuard({ ...process.env, ALLOW_DEMO_TAMPER, DEMO_TAMPER_DB_ALLOW });
  if (refused) {
    console.error(`demo:tamper dibatalkan: ${refused}`);
    process.exitCode = 1;
    return;
  }

  const newAmount = Number(amountArg);
  if (!Number.isInteger(newAmount) || newAmount <= 0) throw new Error('Nominal harus bilangan bulat positif');

  const { PrismaClient } = await import('@prisma/client');
  // datasourceUrl eksplisit = URL yang sudah lolos pengaman (bukan dibaca ulang dari tempat lain).
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const donation =
      target === '--latest'
        ? await prisma.donation.findFirst({
            where: { status: 'PAID', blockchain: { status: 'CONFIRMED' } },
            orderBy: { donatedAt: 'desc' },
          })
        : await prisma.donation.findUnique({ where: { id: target } });
    if (!donation) throw new Error('Donasi tidak ditemukan (atau belum ada yang CONFIRMED di blockchain)');

    const diff = newAmount - donation.amount;
    await prisma.$transaction([
      prisma.donation.update({ where: { id: donation.id }, data: { amount: newAmount } }),
      prisma.campaign.update({ where: { id: donation.campaignId }, data: { currentAmount: { increment: diff } } }),
    ]);

    say('⚠️  Data donasi dimanipulasi langsung di database');
    say(`   Donasi   : ${donation.id}`);
    say(`   Nominal  : ${rupiah(donation.amount)} → ${rupiah(newAmount)}`);
    say(`   Campaign : ${donation.campaignId}`);
    say(`   Pulihkan : ALLOW_DEMO_TAMPER=true pnpm demo:tamper ${donation.id} ${donation.amount} --check`);

    if (check) {
      const result = await runIntegrityCheck(prisma, donation.id, json);
      if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      say('Sekarang buka Admin → Integritas lalu jalankan verifikasi (atau tunggu hash checker otomatis).');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Dijalankan langsung (ts-node), bukan saat di-import test.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}

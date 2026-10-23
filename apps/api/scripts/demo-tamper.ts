/**
 * SIMULASI SERANGAN — mengubah nominal donasi LANGSUNG di database, seolah-olah
 * ada orang dalam yang memanipulasi data. Sengaja tidak lewat API & tidak tercatat di audit log.
 *
 *   pnpm demo:tamper <donationId> <nominalBaru>
 *   pnpm demo:tamper --latest 900000
 *   pnpm demo:tamper --latest 900000 --check   ← langsung jalankan integrity check (untuk demo)
 *
 * Tanpa --check: hash checker otomatis (worker/cron) atau Admin → Integritas yang akan mendeteksi.
 * Hasil yang diharapkan: TAMPERED → campaign FROZEN → pencairan terkunci.
 * Untuk reset setelah demo, jalankan lagi dengan nominal asli + --check, lalu unfreeze dari Admin.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

async function runIntegrityCheck(donationId: string) {
  // Worker tidak perlu jalan di proses script ini.
  process.env.WORKER_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { IntegrityService } = await import('../src/modules/integrity/integrity.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(IntegrityService).verifyDonation(donationId, null, { source: 'DEMO' });
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId } });
    console.log('');
    console.log('🔍 Integrity check');
    console.log(`   Hash dari DB sekarang : ${result.currentHash}`);
    console.log(`   Hash di blockchain    : ${result.onChainHash}`);
    console.log(`   Status donasi         : ${result.status}`);
    console.log(`   Status campaign       : ${campaign.status}${campaign.frozenReason ? ` (${campaign.frozenReason})` : ''}`);
    if (result.status === 'TAMPERED') console.log('🚫 Manipulasi terdeteksi — campaign dibekukan, pencairan dana terkunci.');
    else console.log('✅ Data cocok dengan blockchain.');
  } finally {
    await app.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const [target, amountArg] = args.filter((a) => a !== '--check');
  if (!target || !amountArg) {
    console.log('Pemakaian: pnpm demo:tamper <donationId|--latest> <nominalBaru> [--check]');
    process.exitCode = 1;
    return;
  }
  const newAmount = Number(amountArg);
  if (!Number.isInteger(newAmount) || newAmount <= 0) throw new Error('Nominal harus bilangan bulat positif');

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

  console.log('⚠️  Data donasi dimanipulasi langsung di database');
  console.log(`   Donasi   : ${donation.id}`);
  console.log(`   Nominal  : ${rupiah(donation.amount)} → ${rupiah(newAmount)}`);
  console.log(`   Campaign : ${donation.campaignId}`);
  console.log(`   Pulihkan : pnpm demo:tamper ${donation.id} ${donation.amount} --check`);

  if (check) await runIntegrityCheck(donation.id);
  else console.log('Sekarang buka Admin → Integritas lalu jalankan verifikasi (atau tunggu hash checker otomatis).');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

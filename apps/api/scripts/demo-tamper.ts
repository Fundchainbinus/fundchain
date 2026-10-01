/**
 * SIMULASI SERANGAN — mengubah nominal donasi LANGSUNG di database, seolah-olah
 * ada orang dalam yang memanipulasi data. Sengaja tidak lewat API & tidak tercatat di audit log.
 *
 *   pnpm demo:tamper <donationId> <nominalBaru>
 *   pnpm demo:tamper --latest 900000
 *
 * Setelah itu jalankan Integrity Check di halaman Admin → hasilnya TAMPERED → campaign FROZEN.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [target, amountArg] = process.argv.slice(2);
  if (!target || !amountArg) {
    console.log('Pemakaian: pnpm demo:tamper <donationId|--latest> <nominalBaru>');
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

  const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
  console.log('⚠️  Data donasi dimanipulasi langsung di database');
  console.log(`   Donasi   : ${donation.id}`);
  console.log(`   Nominal  : ${rupiah(donation.amount)} → ${rupiah(newAmount)}`);
  console.log(`   Campaign : ${donation.campaignId}`);
  console.log('Sekarang buka Admin → Integritas lalu jalankan verifikasi. Hasil yang diharapkan: TAMPERED → FROZEN.');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

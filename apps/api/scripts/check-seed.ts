/**
 * BFD-43 — smoke check hasil `prisma db seed`, dipakai job CI "Seed smoke test".
 *
 *   pnpm --filter @fundchain/api exec ts-node --transpile-only scripts/check-seed.ts --out counts.json
 *   pnpm --filter @fundchain/api exec ts-node --transpile-only scripts/check-seed.ts --expect counts.json
 *
 * - Menolak jalan bila DATABASE_URL bukan localhost/127.0.0.1 (tidak boleh menyentuh DB sungguhan).
 * - Memastikan cakupan demo: >= 1 campaign FROZEN, donasi PAID + PENDING + EXPIRED, tepat 2 pencairan.
 * - `--out`: simpan jumlah baris semua tabel. `--expect`: bandingkan dengan file itu (seed kedua harus idempoten).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';

function assertLocalDatabase(url: string | undefined) {
  let host = '';
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    /* host tetap kosong */
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`check-seed hanya boleh dijalankan ke database lokal (host sekarang: "${host || 'tidak valid'}").`);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const failures: string[] = [];

    const frozen = await prisma.campaign.count({ where: { status: 'FROZEN' } });
    if (frozen < 1) failures.push(`campaign FROZEN = ${frozen}, harus >= 1`);

    for (const status of ['PAID', 'PENDING', 'EXPIRED'] as const) {
      const n = await prisma.donation.count({ where: { status } });
      if (n < 1) failures.push(`donasi ${status} = ${n}, harus >= 1`);
      // Setiap donasi seed punya baris payment yang cocok.
      const withoutPayment = await prisma.donation.count({ where: { status, payment: null } });
      if (withoutPayment > 0) failures.push(`${withoutPayment} donasi ${status} tanpa baris payment`);
    }

    const disbursements = await prisma.disbursement.count();
    if (disbursements !== 2) failures.push(`pencairan = ${disbursements}, harus tepat 2`);

    // Jumlah baris semua model (dari DMMF, jadi tabel baru otomatis ikut dibandingkan).
    const counts: Record<string, number> = {};
    for (const model of Prisma.dmmf.datamodel.models) {
      const delegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      counts[model.name] = await (prisma as unknown as Record<string, { count(): Promise<number> }>)[delegate].count();
    }
    console.log(JSON.stringify(counts, null, 2));

    const out = arg('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(counts, null, 2) + '\n');

    const expectFile = arg('--expect');
    if (expectFile) {
      const before = JSON.parse(fs.readFileSync(expectFile, 'utf8')) as Record<string, number>;
      for (const name of new Set([...Object.keys(before), ...Object.keys(counts)])) {
        if (before[name] !== counts[name]) failures.push(`seed tidak idempoten: ${name} ${before[name]} -> ${counts[name]}`);
      }
    }

    if (failures.length > 0) {
      for (const f of failures) console.error(`FAIL: ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: FROZEN=${frozen}, pencairan=${disbursements}${expectFile ? ', seed kedua idempoten' : ''}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * Pindahkan file upload yang masih tersimpan di disk lokal (apps/api/uploads, mode lama
 * STORAGE_DRIVER=local) ke tabel stored_files, supaya bisa dibuka dari Vercel.
 * Jalankan di laptop tempat file itu diunggah:
 *   pnpm --filter @fundchain/api files:sync
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
const TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg' };

async function main() {
  const docs = await prisma.campaignDocument.findMany({ select: { storageKey: true } });
  const proofs = await prisma.disbursement.findMany({ select: { proofKey: true } });
  const keys = [...docs.map((d) => d.storageKey), ...proofs.map((p) => p.proofKey)];
  const stored = new Set((await prisma.storedFile.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((s) => s.key));

  let moved = 0;
  const missing: string[] = [];
  for (const key of keys.filter((k) => !stored.has(k))) {
    const file = path.resolve(uploadDir, key);
    if (!file.startsWith(uploadDir + path.sep) || !fs.existsSync(file)) {
      missing.push(key);
      continue;
    }
    const data = fs.readFileSync(file);
    await prisma.storedFile.create({
      data: { key, data: new Uint8Array(data), contentType: TYPES[path.extname(key)] ?? 'application/octet-stream', size: data.length },
    });
    moved++;
    console.log('✓', key);
  }
  console.log(`Dipindahkan ke database: ${moved}. Tidak ada di laptop ini: ${missing.length}.`);
  if (missing.length) console.log('Belum tersedia (unggah ulang, atau jalankan skrip ini di laptop pengunggahnya):\n  ' + missing.join('\n  '));
}

main().finally(() => prisma.$disconnect());

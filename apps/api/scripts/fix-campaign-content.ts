/**
 * Cari & perbaiki campaign yang deskripsinya asal ketik ("hasjdhjshd…") atau proposalnya dummy.
 * Campaign ACTIVE/COMPLETED tidak bisa diedit lewat aplikasi (hanya DRAFT/REJECTED), jadi
 * perbaikan data lama dilakukan lewat script ini oleh orang yang memegang DATABASE_URL.
 *
 *   pnpm --filter @fundchain/api campaign:fix-content
 *       ← hanya laporan (read-only): daftar campaign bermasalah
 *   pnpm --filter @fundchain/api campaign:fix-content --campaign <id> --apply
 *       ← ganti deskripsi + lampirkan proposal lengkap (bila judulnya punya proposal di prisma/proposals.ts)
 *   ... --description-file <path.txt>   ← deskripsi pengganti dari file (untuk judul lain)
 *   ... --sdg QUALITY_EDUCATION         ← sekalian betulkan kategori SDG
 *
 * Perubahan dicatat di audit_logs (CAMPAIGN_CONTENT_CORRECTED). Deskripsi & proposal tidak ikut
 * canonical payload donasi, jadi hash on-chain tidak terpengaruh.
 */
import { PrismaClient } from '@prisma/client';
import { gibberishProblem, SDG_CODES } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { proposalFor, SERIBU_BUKU_DESCRIPTION } from '../prisma/proposals';
import { buildDocumentPdf } from '../prisma/sample-pdf';

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  'Gerakan Seribu Buku untuk Anak Negeri': SERIBU_BUKU_DESCRIPTION,
};

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function report(prisma: PrismaClient) {
  const rows = await prisma.campaign.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, status: true, description: true, documents: { select: { originalName: true, size: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const bad = rows
    .map((c) => ({ c, problem: gibberishProblem(c.description) }))
    .filter(({ c, problem }) => problem || c.documents.every((d) => d.size < 2_000));
  if (!bad.length) return console.log(`Semua ${rows.length} campaign punya deskripsi & proposal yang wajar.`);
  console.log(`${bad.length} dari ${rows.length} campaign perlu diperbaiki:\n`);
  for (const { c, problem } of bad) {
    console.log(`- ${c.id}  [${c.status}]  ${c.title}`);
    if (problem) console.log(`    deskripsi: ${problem}`);
    if (c.documents.every((d) => d.size < 2_000)) console.log(`    proposal: ${c.documents.map((d) => `${d.originalName} (${d.size} B)`).join(', ') || 'tidak ada'} → kemungkinan dummy`);
    console.log(`    teks & proposal siap pakai: ${KNOWN_DESCRIPTIONS[c.title] && proposalFor(c.title) ? 'ADA' : 'tidak ada → pakai --description-file'}`);
  }
}

async function apply(prisma: PrismaClient, id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new Error(`Campaign ${id} tidak ditemukan.`);
  const file = arg('--description-file');
  const description = file ? fs.readFileSync(file, 'utf8').trim() : KNOWN_DESCRIPTIONS[c.title];
  if (!description) throw new Error(`Tidak ada deskripsi siap pakai untuk "${c.title}". Pakai --description-file <path>.`);
  const problem = gibberishProblem(description);
  if (problem) throw new Error(`Deskripsi pengganti ditolak: ${problem}`);
  const sdg = arg('--sdg');
  if (sdg && !(SDG_CODES as string[]).includes(sdg)) throw new Error(`Kode SDG tidak dikenal: ${sdg}`);

  const doc = proposalFor(c.title);
  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id }, data: { description, ...(sdg ? { sdgCategory: sdg } : {}) } });
    let documentId: string | null = null;
    if (doc) {
      const pdf = buildDocumentPdf(doc);
      const key = `proposals/${id}/${randomUUID()}.pdf`;
      const name = `proposal-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
      await tx.storedFile.create({
        data: { key, data: new Uint8Array(pdf), contentType: 'application/pdf', size: pdf.length, storageDriver: 'db', purpose: 'campaign-document', originalName: name },
      });
      documentId = (await tx.campaignDocument.create({ data: { campaignId: id, originalName: name, storageKey: key, fileType: 'application/pdf', size: pdf.length } })).id;
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'CAMPAIGN_CONTENT_CORRECTED',
        entityType: 'Campaign',
        entityId: id,
        metadata: JSON.stringify({
          reason: 'Deskripsi/proposal asal ketik diganti konten yang layak tampil (scripts/fix-campaign-content.ts).',
          previousDescriptionLength: c.description.length,
          ...(sdg ? { previousSdg: c.sdgCategory, sdg } : {}),
          ...(documentId ? { documentId } : {}),
        }),
      },
    });
  });
  console.log(`✓ ${c.title}: deskripsi diganti${sdg ? `, SDG ${c.sdgCategory} → ${sdg}` : ''}${doc ? ', proposal lengkap dilampirkan' : ''}.`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const id = arg('--campaign');
    if (id && process.argv.includes('--apply')) await apply(prisma, id);
    else {
      if (id) console.log('(Tanpa --apply: hanya laporan, tidak ada yang diubah.)\n');
      await report(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

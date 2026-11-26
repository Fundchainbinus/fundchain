/**
 * Cari & perbaiki campaign yang deskripsinya asal ketik ("hasjdhjshd…") atau proposalnya dummy.
 * Campaign ACTIVE/COMPLETED tidak bisa diedit lewat aplikasi (hanya DRAFT/REJECTED), jadi
 * perbaikan data lama dilakukan lewat script ini oleh orang yang memegang DATABASE_URL.
 *
 *   pnpm --filter @fundchain/api campaign:fix-content
 *       ← laporan saja (read-only): apa yang salah dan apa yang AKAN diubah
 *   pnpm --filter @fundchain/api campaign:fix-content --all --apply
 *       ← perbaiki SEMUA campaign yang punya konten siap pakai (prisma/proposals.ts)
 *   pnpm --filter @fundchain/api campaign:fix-content --campaign <id> --apply [--description-file f.txt] [--sdg KODE]
 *       ← satu campaign; --description-file untuk judul yang belum punya konten siap pakai
 *
 * Yang diubah per campaign (hanya bila perlu):
 *   - deskripsi asal ketik → deskripsi siap pakai,
 *   - proposal dummy (<2KB atau nama test*) → proposal PDF lengkap DITAMBAHKAN (dokumen lama tidak dihapus;
 *     halaman campaign menampilkan dokumen terbaru),
 *   - SDG yang salah isi → SDG yang benar.
 * Setiap perubahan dicatat di audit_logs (CAMPAIGN_CONTENT_CORRECTED). Deskripsi, proposal, dan SDG tidak ikut
 * canonical payload donasi, jadi hash on-chain tidak terpengaruh.
 */
import { PrismaClient } from '@prisma/client';
import { gibberishProblem, SDG_CODES } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { PREPARED_DESCRIPTIONS, PREPARED_SDG, proposalFor } from '../prisma/proposals';
import { buildDocumentPdf } from '../prisma/sample-pdf';

type Doc = { originalName: string; size: number; createdAt: Date };
type Row = { id: string; title: string; status: string; description: string; sdgCategory: string; documents: Doc[] };

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Proposal dianggap dummy bila dokumen terbaru kecil (<2KB) atau bernama test*. */
function dummyProposal(docs: Doc[]) {
  const latest = [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return !latest || latest.size < 2_000 || /^test/i.test(latest.originalName);
}

interface Plan {
  description?: string;
  sdg?: string;
  attachProposal: boolean;
  problems: string[];
}

function planFor(c: Row, overrides: { description?: string; sdg?: string } = {}): Plan {
  const problems: string[] = [];
  const descProblem = gibberishProblem(c.description);
  if (descProblem) problems.push(`deskripsi: ${descProblem}`);
  const dummy = dummyProposal(c.documents);
  if (dummy) problems.push(`proposal dummy: ${c.documents.map((d) => `${d.originalName} (${d.size} B)`).join(', ') || 'tidak ada'}`);

  const newDesc = overrides.description ?? (descProblem ? PREPARED_DESCRIPTIONS[c.title] : undefined);
  const newSdg = overrides.sdg ?? PREPARED_SDG[c.title];
  if (newSdg && newSdg !== c.sdgCategory) problems.push(`SDG ${c.sdgCategory} tidak cocok`);
  return {
    description: newDesc,
    sdg: newSdg && newSdg !== c.sdgCategory ? newSdg : undefined,
    attachProposal: dummy && proposalFor(c.title) !== null,
    problems,
  };
}

async function load(prisma: PrismaClient, where: object = {}): Promise<Row[]> {
  return prisma.campaign.findMany({
    where: { deletedAt: null, ...where },
    select: {
      id: true,
      title: true,
      status: true,
      description: true,
      sdgCategory: true,
      documents: { select: { originalName: true, size: true, createdAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

function describe(c: Row, p: Plan) {
  console.log(`- ${c.id}  [${c.status}]  ${c.title}`);
  for (const pr of p.problems) console.log(`    masalah  : ${pr}`);
  const actions = [
    p.description ? 'ganti deskripsi' : null,
    p.attachProposal ? 'lampirkan proposal lengkap' : null,
    p.sdg ? `SDG → ${p.sdg}` : null,
  ].filter(Boolean);
  const missing = p.problems.some((x) => x.startsWith('deskripsi')) && !p.description;
  console.log(`    tindakan : ${actions.join(', ') || '—'}${missing ? '  (deskripsi belum ada → pakai --description-file)' : ''}`);
}

async function apply(prisma: PrismaClient, c: Row, p: Plan) {
  if (p.description) {
    const problem = gibberishProblem(p.description);
    if (problem) throw new Error(`Deskripsi pengganti untuk "${c.title}" ditolak: ${problem}`);
  }
  if (p.sdg && !(SDG_CODES as string[]).includes(p.sdg)) throw new Error(`Kode SDG tidak dikenal: ${p.sdg}`);
  if (!p.description && !p.sdg && !p.attachProposal) return false;

  const doc = p.attachProposal ? proposalFor(c.title) : null;
  await prisma.$transaction(async (tx) => {
    if (p.description || p.sdg) {
      await tx.campaign.update({
        where: { id: c.id },
        data: { ...(p.description ? { description: p.description } : {}), ...(p.sdg ? { sdgCategory: p.sdg } : {}) },
      });
    }
    let documentId: string | null = null;
    if (doc) {
      const pdf = buildDocumentPdf(doc);
      const key = `proposals/${c.id}/${randomUUID()}.pdf`;
      const name = `proposal-${slug(c.title)}.pdf`;
      await tx.storedFile.create({
        data: { key, data: new Uint8Array(pdf), contentType: 'application/pdf', size: pdf.length, storageDriver: 'db', purpose: 'campaign-document', originalName: name },
      });
      documentId = (await tx.campaignDocument.create({ data: { campaignId: c.id, originalName: name, storageKey: key, fileType: 'application/pdf', size: pdf.length } })).id;
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'CAMPAIGN_CONTENT_CORRECTED',
        entityType: 'Campaign',
        entityId: c.id,
        metadata: JSON.stringify({
          reason: 'Konten asal ketik / proposal dummy diganti konten yang layak tampil (scripts/fix-campaign-content.ts).',
          ...(p.description ? { previousDescription: c.description.slice(0, 500) } : {}),
          ...(p.sdg ? { previousSdg: c.sdgCategory, sdg: p.sdg } : {}),
          ...(documentId ? { documentId } : {}),
        }),
      },
    });
  });
  return true;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const id = arg('--campaign');
    const doApply = process.argv.includes('--apply');
    const file = arg('--description-file');
    const overrides = { description: file ? fs.readFileSync(file, 'utf8').trim() : undefined, sdg: arg('--sdg') };

    const rows = id ? await load(prisma, { id }) : await load(prisma);
    if (id && !rows.length) throw new Error(`Campaign ${id} tidak ditemukan.`);
    const plans = rows.map((c) => ({ c, p: planFor(c, id ? overrides : {}) })).filter(({ p }) => p.problems.length);

    if (!plans.length) return console.log(`Semua ${rows.length} campaign sudah wajar. Tidak ada yang diubah.`);
    console.log(`${plans.length} dari ${rows.length} campaign bermasalah:\n`);
    for (const { c, p } of plans) describe(c, p);

    if (!doApply || (!id && !process.argv.includes('--all'))) {
      console.log('\nBelum ada yang diubah. Jalankan dengan --all --apply (semua) atau --campaign <id> --apply (satu).');
      return;
    }
    console.log('');
    let changed = 0;
    for (const { c, p } of plans) {
      if (await apply(prisma, c, p)) {
        changed++;
        console.log(`✓ ${c.title}`);
      }
    }
    console.log(`\nSelesai: ${changed} campaign diperbarui. Tercatat di audit log (CAMPAIGN_CONTENT_CORRECTED).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

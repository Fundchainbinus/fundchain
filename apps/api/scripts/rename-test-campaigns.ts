/**
 * Ganti campaign uji coba ("test20", "guegue", "Kampanye main gta 6", …) dengan judul, deskripsi, dan
 * proposal yang realistis (prisma/renamed-campaigns.ts), lalu lampirkan ulang semua proposal siap pakai
 * dengan tata letak PDF baru (teks tidak lagi terpotong di kanan).
 *
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/rename-test-campaigns.ts           ← lihat rencana
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/rename-test-campaigns.ts --apply   ← jalankan
 *
 * Pemilik, status, SDG, target, dan donasi tidak diubah. Dokumen lama tidak dihapus (proposal terbaru yang
 * tampil). Setiap perubahan dicatat di audit_logs (CAMPAIGN_CONTENT_CORRECTED) beserta judul & deskripsi lama.
 * Aman dijalankan ulang: campaign yang sudah diganti dan proposal versi baru yang sudah terlampir dilewati.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { gibberishProblem } from '@fundchain/shared';
import { proposalFor } from '../prisma/proposals';
import { RENAMED_CAMPAIGNS } from '../prisma/renamed-campaigns';
import { buildDocumentPdf } from '../prisma/sample-pdf';

/** Penanda versi tata letak di nama file, supaya proposal yang sudah diperbarui tidak dilampirkan dua kali. */
const LAYOUT_VERSION = 'v2';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileName = (title: string) => `proposal-${slug(title)}-${LAYOUT_VERSION}.pdf`;

function target() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL belum di-set (jalankan dengan node --env-file=.env).');
  const u = new URL(raw);
  return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
}

async function main() {
  const doApply = process.argv.includes('--apply');
  console.log(`Database: ${target()}${doApply ? '' : '  (simulasi — belum ada yang diubah)'}\n`);
  if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;
  const prisma = new PrismaClient();
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, description: true, status: true, documents: { select: { originalName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byId = new Map(campaigns.map((c) => [c.id, c]));

    type Plan = { id: string; status: string; from: string; to: string; description?: string; previousDescription?: string; attach: boolean };
    const plans: Plan[] = [];

    for (const r of RENAMED_CAMPAIGNS) {
      const c = byId.get(r.id);
      if (!c) {
        console.log(`! ${r.id} (${r.oldTitle}) tidak ditemukan — dilewati.`);
        continue;
      }
      const problem = gibberishProblem(r.description);
      if (problem) throw new Error(`Deskripsi "${r.title}" ditolak: ${problem}`);
      if (c.title === r.title) {
        // sudah diganti sebelumnya; hanya pastikan proposal versi baru ada
        plans.push({ id: c.id, status: c.status, from: c.title, to: c.title, attach: !c.documents.some((d) => d.originalName === fileName(r.title)) });
      } else if (c.title === r.oldTitle) {
        plans.push({ id: c.id, status: c.status, from: c.title, to: r.title, description: r.description, previousDescription: c.description, attach: true });
      } else {
        console.log(`! ${r.id} berjudul "${c.title}", bukan "${r.oldTitle}" — diubah orang lain, dilewati.`);
      }
    }
    // Campaign lain yang proposalnya dibuat FundChain: lampirkan ulang dengan tata letak baru.
    for (const c of campaigns) {
      if (plans.some((p) => p.id === c.id) || !proposalFor(c.title)) continue;
      plans.push({ id: c.id, status: c.status, from: c.title, to: c.title, attach: !c.documents.some((d) => d.originalName === fileName(c.title)) });
    }

    const todo = plans.filter((p) => p.description || p.attach);
    for (const p of plans) {
      const rename = p.from !== p.to ? `"${p.from}" → "${p.to}"` : `"${p.to}"`;
      const actions = [p.description ? 'ganti judul & deskripsi' : null, p.attach ? 'lampirkan proposal baru' : null].filter(Boolean);
      console.log(`- [${p.status}] ${rename}\n    ${actions.join(', ') || 'sudah mutakhir'}`);
    }
    if (!todo.length) return console.log('\nSemua sudah mutakhir. Tidak ada yang diubah.');
    if (!doApply) return console.log(`\n${todo.length} campaign akan diubah. Jalankan dengan --apply.`);

    console.log('');
    for (const p of todo) {
      const doc = p.attach ? proposalFor(p.to) : null;
      await prisma.$transaction(async (tx) => {
        if (p.description) {
          await tx.campaign.update({ where: { id: p.id }, data: { title: p.to, description: p.description } });
        }
        let documentId: string | null = null;
        if (doc) {
          const pdf = buildDocumentPdf(doc);
          const key = `proposals/${p.id}/${randomUUID()}.pdf`;
          const name = fileName(p.to);
          await tx.storedFile.create({
            data: { key, data: new Uint8Array(pdf), contentType: 'application/pdf', size: pdf.length, storageDriver: 'db', purpose: 'campaign-document', originalName: name },
          });
          documentId = (
            await tx.campaignDocument.create({ data: { campaignId: p.id, originalName: name, storageKey: key, fileType: 'application/pdf', size: pdf.length } })
          ).id;
        }
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: 'CAMPAIGN_CONTENT_CORRECTED',
            entityType: 'Campaign',
            entityId: p.id,
            metadata: JSON.stringify({
              reason: p.description
                ? 'Campaign uji coba diganti dengan rencana kegiatan yang realistis (scripts/rename-test-campaigns.ts).'
                : 'Proposal dilampirkan ulang dengan tata letak PDF baru (scripts/rename-test-campaigns.ts).',
              ...(p.description ? { previousTitle: p.from, title: p.to, previousDescription: (p.previousDescription ?? '').slice(0, 500) } : {}),
              ...(documentId ? { documentId } : {}),
            }),
          },
        });
      });
      console.log(`✓ ${p.to}`);
    }
    console.log(`\nSelesai: ${todo.length} campaign diperbarui. Tercatat di audit log (CAMPAIGN_CONTENT_CORRECTED).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

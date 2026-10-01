/**
 * Seed demo — idempotent (users di-upsert, campaign hanya dibuat jika belum ada).
 * Donasi PAID dibuat lengkap dengan canonical payload + hash, lalu diantrekan untuk
 * notarisasi sehingga worker menulisnya ke blockchain saat API berjalan.
 */
import { PrismaClient } from '@prisma/client';
import { hashDonation, toOnchainKey } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSamplePdf } from './sample-pdf';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');

const USERS = [
  { email: 'admin@binus.ac.id', name: 'Admin BINUS', role: 'ADMIN', integritySubjectId: 'ADM-00001' },
  { email: 'budi.santoso@binus.ac.id', name: 'Budi Santoso', role: 'STUDENT', integritySubjectId: 'STU-00001' },
  { email: 'siti.rahma@binus.ac.id', name: 'Siti Rahma', role: 'STUDENT', integritySubjectId: 'STU-00002' },
  { email: 'andi.wijaya@binus.ac.id', name: 'Andi Wijaya', role: 'STUDENT', integritySubjectId: 'STU-00003' },
];

function floorToSecond(d: Date) {
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

async function saveProposal(campaignId: string, title: string) {
  const key = `proposals/${campaignId}/${randomUUID()}.pdf`;
  const file = path.join(uploadDir, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pdf = buildSamplePdf(`Proposal: ${title}`, [
    'Latar belakang, tujuan, dan rencana penggunaan dana.',
    'Dokumen contoh yang dibuat otomatis oleh seed FundChain.',
  ]);
  fs.writeFileSync(file, pdf);
  await prisma.campaignDocument.create({
    data: { campaignId, originalName: 'proposal.pdf', storageKey: key, fileType: 'application/pdf', size: pdf.length },
  });
}

async function paidDonation(campaignId: string, donorId: string, subject: string, amount: number, daysAgo: number, anonymous = false) {
  const id = randomUUID();
  const donatedAt = floorToSecond(new Date(Date.now() - daysAgo * DAY));
  const { payload, hash } = hashDonation({ donationId: id, integritySubjectId: subject, amount, donatedAt });
  await prisma.donation.create({
    data: {
      id,
      campaignId,
      donorId,
      amount,
      isAnonymous: anonymous,
      status: 'PAID',
      idempotencyKey: `seed-${id}`,
      donatedAt,
      canonicalPayload: payload,
      hash,
      createdAt: donatedAt,
      payment: {
        create: {
          provider: 'mock',
          externalPaymentId: `MOCK-SEED-${id}`,
          method: 'QRIS',
          amount,
          status: 'SETTLED',
          paidAt: donatedAt,
        },
      },
      blockchain: {
        create: {
          network: process.env.BLOCKCHAIN_NETWORK || 'localhost',
          chainId: Number(process.env.CHAIN_ID || 31337),
          onchainKey: toOnchainKey(id),
          status: 'QUEUED',
        },
      },
    },
  });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentAmount: { increment: amount } } });
}

async function main() {
  const users: Record<string, { id: string; integritySubjectId: string }> = {};
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, microsoftId: `seed-${u.integritySubjectId}` },
    });
    users[u.email] = user;
  }
  const admin = users['admin@binus.ac.id'];
  const budi = users['budi.santoso@binus.ac.id'];
  const siti = users['siti.rahma@binus.ac.id'];
  const andi = users['andi.wijaya@binus.ac.id'];

  // File contoh untuk diunggah saat demo.
  const samplesDir = path.resolve(process.cwd(), '../../samples');
  fs.mkdirSync(samplesDir, { recursive: true });
  fs.writeFileSync(
    path.join(samplesDir, 'proposal-contoh.pdf'),
    buildSamplePdf('Proposal Campaign FundChain', ['Contoh proposal untuk demo upload.']),
  );
  fs.writeFileSync(
    path.join(samplesDir, 'bukti-milestone-contoh.pdf'),
    buildSamplePdf('Bukti Milestone', ['Nota pembelian & rencana penggunaan dana tahap 1.']),
  );

  if ((await prisma.campaign.count()) > 0) {
    console.log('Campaign sudah ada — seed campaign dilewati.');
    return;
  }

  const water = await prisma.campaign.create({
    data: {
      creatorId: budi.id,
      title: 'Air Bersih untuk Desa Sukamaju',
      description:
        'Membangun sistem penyaringan dan penampungan air bersih untuk 200 keluarga di Desa Sukamaju, Bogor. Dana digunakan untuk pipa, tandon, filter, dan pelatihan perawatan oleh warga.',
      sdgCategory: 'CLEAN_WATER',
      targetAmount: 15_000_000,
      deadline: new Date(Date.now() + 30 * DAY),
      status: 'ACTIVE',
    },
  });
  const books = await prisma.campaign.create({
    data: {
      creatorId: siti.id,
      title: 'Buku & Perpustakaan Mini untuk Anak Pesisir',
      description:
        'Menyediakan 500 buku bacaan dan rak perpustakaan mini untuk tiga sekolah dasar di pesisir Tangerang, plus program membaca mingguan oleh relawan mahasiswa BINUS.',
      sdgCategory: 'QUALITY_EDUCATION',
      targetAmount: 8_000_000,
      deadline: new Date(Date.now() + 45 * DAY),
      status: 'ACTIVE',
    },
  });
  const solar = await prisma.campaign.create({
    data: {
      creatorId: andi.id,
      title: 'Panel Surya untuk SD Harapan',
      description:
        'Pemasangan panel surya 2 kWp agar SD Harapan di Lebak memiliki listrik stabil untuk kegiatan belajar dan laboratorium komputer sederhana.',
      sdgCategory: 'CLEAN_ENERGY',
      targetAmount: 25_000_000,
      deadline: new Date(Date.now() + 60 * DAY),
      status: 'PENDING_REVIEW',
    },
  });
  const waste = await prisma.campaign.create({
    data: {
      creatorId: budi.id,
      title: 'Bank Sampah Kampus Anggrek',
      description: 'Rintisan bank sampah di kampus untuk memilah dan mendaur ulang sampah plastik mahasiswa.',
      sdgCategory: 'RESPONSIBLE_CONSUMPTION',
      targetAmount: 5_000_000,
      deadline: new Date(Date.now() + 40 * DAY),
      status: 'DRAFT',
    },
  });
  const coding = await prisma.campaign.create({
    data: {
      creatorId: siti.id,
      title: 'Kelas Coding Gratis untuk Remaja',
      description: 'Kelas pemrograman dasar selama 8 minggu untuk remaja putus sekolah di Jakarta Barat.',
      sdgCategory: 'DECENT_WORK',
      targetAmount: 12_000_000,
      deadline: new Date(Date.now() + 50 * DAY),
      status: 'REJECTED',
      rejectionReason: 'Proposal belum menjelaskan rincian penggunaan dana per item.',
    },
  });

  for (const c of [water, books, solar, coding]) await saveProposal(c.id, c.title);

  await prisma.campaignReview.createMany({
    data: [
      { campaignId: water.id, adminId: admin.id, decision: 'APPROVE' },
      { campaignId: books.id, adminId: admin.id, decision: 'APPROVE' },
      { campaignId: coding.id, adminId: admin.id, decision: 'REJECT', reason: 'Proposal belum menjelaskan rincian penggunaan dana per item.' },
    ],
  });

  await paidDonation(water.id, siti.id, siti.integritySubjectId, 250_000, 6);
  await paidDonation(water.id, andi.id, andi.integritySubjectId, 100_000, 4, true);
  await paidDonation(water.id, admin.id, admin.integritySubjectId, 1_000_000, 2);
  await paidDonation(books.id, budi.id, budi.integritySubjectId, 150_000, 5);
  await paidDonation(books.id, andi.id, andi.integritySubjectId, 500_000, 1);

  const audit = (actorId: string | null, action: string, entityId: string, metadata = {}) =>
    prisma.auditLog.create({ data: { actorId, action, entityType: 'Campaign', entityId, metadata: JSON.stringify(metadata) } });
  for (const c of [water, books, solar, waste, coding]) await audit(c.creatorId, 'CAMPAIGN_CREATED', c.id);
  await audit(admin.id, 'CAMPAIGN_APPROVED', water.id);
  await audit(admin.id, 'CAMPAIGN_APPROVED', books.id);
  await audit(admin.id, 'CAMPAIGN_REJECTED', coding.id, { reason: coding.rejectionReason });

  console.log('Seed selesai: 4 user, 5 campaign, 5 donasi PAID (antre notarisasi).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

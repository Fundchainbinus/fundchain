/**
 * Seed demo — idempotent (users di-upsert, campaign hanya dibuat jika belum ada).
 * Donasi PAID dibuat lengkap dengan canonical payload + hash, lalu diantrekan untuk
 * notarisasi sehingga worker menulisnya ke blockchain saat API berjalan.
 *
 * Cakupan demo (BFD-43): campaign di semua status termasuk FROZEN, donasi PAID/PENDING/EXPIRED
 * (masing-masing dengan baris payment yang cocok), dan dua pencairan (PAID + REQUESTED).
 * Karena campaign dilewati bila sudah ada, DB lama perlu di-reset dulu agar data baru masuk.
 */
import { PrismaClient } from '@prisma/client';
import { hashDonation, toOnchainKey } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSamplePdf } from './sample-pdf';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

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
  const pdf = buildSamplePdf(`Proposal: ${title}`, [
    'Latar belakang, tujuan, dan rencana penggunaan dana.',
    'Dokumen contoh yang dibuat otomatis oleh seed FundChain.',
  ]);
  // Simpan ke database (stored_files) agar terbaca di semua lingkungan, termasuk Vercel.
  await prisma.storedFile.create({ data: { key, data: new Uint8Array(pdf), contentType: 'application/pdf', size: pdf.length } });
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
  return id;
}

/**
 * Donasi yang belum/tidak pernah dibayar: tanpa donatedAt, payload, hash, maupun baris blockchain,
 * dan tidak menambah currentAmount (sama seperti alur createCharge → expireStale di aplikasi).
 */
async function unpaidDonation(
  status: 'PENDING' | 'EXPIRED',
  campaignId: string,
  donorId: string,
  amount: number,
  createdDaysAgo: number,
) {
  const id = randomUUID();
  const createdAt = floorToSecond(new Date(Date.now() - createdDaysAgo * DAY));
  // PENDING: kedaluwarsa jauh ke depan supaya housekeeping (expireStale) tidak langsung
  // mengubahnya jadi EXPIRED sebelum demo. EXPIRED: batas waktunya sudah lewat.
  const expiresAt = status === 'PENDING' ? new Date(Date.now() + 7 * DAY) : new Date(createdAt.getTime() + 15 * 60_000);
  await prisma.donation.create({
    data: {
      id,
      campaignId,
      donorId,
      amount,
      status,
      idempotencyKey: `seed-${id}`,
      createdAt,
      payment: {
        create: {
          provider: 'mock',
          externalPaymentId: `MOCK-SEED-${id}`,
          method: 'QRIS',
          amount,
          status,
          qrString: `FUNDCHAIN-MOCK-QRIS|${id}|${amount}`,
          expiresAt,
          createdAt,
        },
      },
    },
  });
  return id;
}

/** Bukti pencairan disimpan di stored_files seperti StorageService.save. */
async function saveDisbursementProof(campaignId: string, title: string) {
  const key = `disbursements/${campaignId}/${randomUUID()}.pdf`;
  const pdf = buildSamplePdf(title, ['Nota pembelian & rencana penggunaan dana.', 'Dokumen contoh yang dibuat otomatis oleh seed FundChain.']);
  await prisma.storedFile.create({ data: { key, data: new Uint8Array(pdf), contentType: 'application/pdf', size: pdf.length } });
  return { proofKey: key, proofName: 'bukti-milestone.pdf', proofType: 'application/pdf' };
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

  const FROZEN_REASON = 'Manual: Laporan penggunaan dana tidak sesuai proposal, menunggu klarifikasi pembuat campaign.';
  const hydro = await prisma.campaign.create({
    data: {
      creatorId: andi.id,
      title: 'Kebun Hidroponik Rusun Marunda',
      description:
        'Membangun kebun hidroponik komunal di atap rusun Marunda agar warga punya sumber sayur murah, lengkap dengan pelatihan perawatan dan pemasaran hasil panen.',
      sdgCategory: 'ZERO_HUNGER',
      targetAmount: 10_000_000,
      deadline: new Date(Date.now() + 35 * DAY),
      status: 'FROZEN',
      frozenReason: FROZEN_REASON,
      // Baru dibekukan: soft-delete otomatis baru jalan setelah FROZEN_SOFT_DELETE_DAYS (default 30 hari).
      frozenAt: new Date(Date.now() - 2 * DAY),
    },
  });

  for (const c of [water, books, solar, coding, hydro]) await saveProposal(c.id, c.title);

  await prisma.campaignReview.createMany({
    data: [
      { campaignId: water.id, adminId: admin.id, decision: 'APPROVE' },
      { campaignId: books.id, adminId: admin.id, decision: 'APPROVE' },
      { campaignId: hydro.id, adminId: admin.id, decision: 'APPROVE' },
      { campaignId: coding.id, adminId: admin.id, decision: 'REJECT', reason: 'Proposal belum menjelaskan rincian penggunaan dana per item.' },
    ],
  });

  await paidDonation(water.id, siti.id, siti.integritySubjectId, 250_000, 6);
  await paidDonation(water.id, andi.id, andi.integritySubjectId, 100_000, 4, true);
  await paidDonation(water.id, admin.id, admin.integritySubjectId, 1_000_000, 2);
  await paidDonation(books.id, budi.id, budi.integritySubjectId, 150_000, 5);
  await paidDonation(books.id, andi.id, andi.integritySubjectId, 500_000, 1);
  // Donasi PAID di campaign FROZEN — kandidat demo refund manual (BFD-75).
  await paidDonation(hydro.id, budi.id, budi.integritySubjectId, 200_000, 8);
  await paidDonation(hydro.id, siti.id, siti.integritySubjectId, 300_000, 5);

  // Donasi belum dibayar / kedaluwarsa (BFD-20/22).
  await unpaidDonation('PENDING', water.id, andi.id, 75_000, 0);
  await unpaidDonation('PENDING', books.id, admin.id, 50_000, 0);
  const expired = [
    await unpaidDonation('EXPIRED', water.id, siti.id, 300_000, 3),
    await unpaidDonation('EXPIRED', books.id, budi.id, 25_000, 2),
  ];

  // Pencairan bertahap di campaign ACTIVE "Air Bersih" (saldo 1.350.000): milestone 1 sudah PAID,
  // milestone 2 masih REQUESTED. Total terikat 900.000 <= currentAmount (aturan saldo) dan hanya
  // satu milestone terbuka (aturan BFD-97).
  const paidDisbursement = await prisma.disbursement.create({
    data: {
      campaignId: water.id,
      requesterId: budi.id,
      amount: 500_000,
      description: 'Milestone 1: pembelian pipa dan tandon air 1.000 liter.',
      ...(await saveDisbursementProof(water.id, 'Bukti Milestone 1: Pipa & Tandon')),
      status: 'PAID',
      adminId: admin.id,
      // Diajukan setelah donasi Rp1.000.000 (2 hari lalu) masuk, jadi saldo saat itu sudah cukup.
      requestedAt: new Date(Date.now() - 1.5 * DAY),
      approvedAt: new Date(Date.now() - 1.25 * DAY),
      paidAt: new Date(Date.now() - 1 * DAY),
    },
  });
  const requestedDisbursement = await prisma.disbursement.create({
    data: {
      campaignId: water.id,
      requesterId: budi.id,
      amount: 400_000,
      description: 'Milestone 2: filter air dan pelatihan perawatan untuk warga.',
      ...(await saveDisbursementProof(water.id, 'Bukti Milestone 2: Filter & Pelatihan')),
      status: 'REQUESTED',
      requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });

  const audit = (actorId: string | null, action: string, entityId: string, metadata = {}) =>
    prisma.auditLog.create({ data: { actorId, action, entityType: 'Campaign', entityId, metadata: JSON.stringify(metadata) } });
  for (const c of [water, books, solar, waste, coding, hydro]) await audit(c.creatorId, 'CAMPAIGN_CREATED', c.id);
  await audit(admin.id, 'CAMPAIGN_APPROVED', water.id);
  await audit(admin.id, 'CAMPAIGN_APPROVED', books.id);
  await audit(admin.id, 'CAMPAIGN_REJECTED', coding.id, { reason: coding.rejectionReason });
  await audit(admin.id, 'CAMPAIGN_APPROVED', hydro.id);
  await audit(admin.id, 'CAMPAIGN_FROZEN', hydro.id, { reason: FROZEN_REASON, previousStatus: 'ACTIVE' });
  const d1 = { disbursementId: paidDisbursement.id, amount: paidDisbursement.amount };
  await audit(budi.id, 'DISBURSEMENT_REQUESTED', water.id, d1);
  await audit(admin.id, 'DISBURSEMENT_APPROVED', water.id, d1);
  await audit(admin.id, 'DISBURSEMENT_PAID', water.id, d1);
  await audit(budi.id, 'DISBURSEMENT_REQUESTED', water.id, { disbursementId: requestedDisbursement.id, amount: requestedDisbursement.amount });
  for (const id of expired) {
    await prisma.auditLog.create({ data: { actorId: null, action: 'PAYMENT_EXPIRED', entityType: 'Donation', entityId: id, metadata: JSON.stringify({ provider: 'mock' }) } });
  }

  console.log(
    'Seed selesai: 4 user, 6 campaign (termasuk 1 FROZEN), 11 donasi (7 PAID antre notarisasi, 2 PENDING, 2 EXPIRED), 2 pencairan (PAID + REQUESTED).',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

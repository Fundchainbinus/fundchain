import * as fs from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { Api, type DonationDetail, type Session, browserContextFor, createActiveCampaign, donateAndPay, pollUntil, waitNotarized } from '../helpers/api';
import { SAMPLE_MILESTONE, SAMPLE_PROPOSAL } from '../helpers/env';
import { StepLog, scrollToTop, shot, writeJson } from '../helpers/evidence';
import { runDemoTamper } from '../helpers/tamper';

/**
 * Gate 3 + BFD-70: gladi bersih skrip demo `FundChain_Complete_Planning_Docs/13-DEMO-FLOW.md` end-to-end,
 * direkam (video + trace per persona) dan diunggah sebagai artifact `e2e-video-trace`.
 * Langkah yang di dokumen memakai layanan eksternal dijalankan lewat fallback demo (dicatat di kolom "expected").
 */
const XFF = '10.0.5.10';
const PAUSE = 700; // jeda kecil supaya video enak ditonton

const log = new StepLog('gate3-dry-run', [
  { id: 'D-1', name: '1. Login', expected: 'Login Microsoft BINUS DISUBSTITUSI DEMO_MODE (SSO belum tersedia) → login persona Mahasiswa berhasil' },
  { id: 'D-2', name: '2. Create Campaign', expected: 'Mahasiswa mengisi title, SDG, target, deadline, proposal PDF → status PENDING_REVIEW' },
  { id: 'D-3', name: '3. Admin Review', expected: 'Admin membuka antrean review → approve → status ACTIVE' },
  { id: 'D-4', name: '4. Donation', expected: 'Donor donasi; pembayaran QRIS/VA DISUBSTITUSI QRIS mock; webhook SETTLED → donasi PAID' },
  { id: 'D-5', name: '5. Blockchain', expected: 'Canonical payload v1 → Keccak-256 → antre → relayer submit → txHash tersimpan (CONFIRMED)' },
  { id: 'D-6', name: '6. Transparency', expected: 'Donasi, nominal, status verifikasi VERIFIED/COCOK, txHash tampil; explorer Sepolia DISUBSTITUSI chain lokal (tanpa link Etherscan)' },
  { id: 'D-7', name: '7. Tamper Simulation', expected: 'Rp100.000 → Rp900.000 di DB; integrity checker → TAMPERED; campaign FROZEN; pencairan LOCKED' },
  { id: 'D-8', name: '8. Disbursement (campaign normal)', expected: 'Creator ajukan + unggah bukti → admin approve → mark paid (PAID)' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

async function recordedContext(browser: Parameters<typeof browserContextFor>[0], session: Session | null, name: string, dir: string) {
  // Trace untuk konteks ini dimulai otomatis oleh Playwright (`trace: 'on'` di project dry-run) dan disimpan
  // sebagai trace.zip di folder test-results; video direkam eksplisit per persona.
  return browserContextFor(browser, session, XFF, { recordVideo: { dir: `${dir}/${name}`, size: { width: 1280, height: 800 } } });
}

async function closeRecorded(ctx: BrowserContext) {
  await ctx.close();
}

async function uiDemoLogin(page: Page, button: 'Demo Mahasiswa' | 'Demo Admin') {
  await page.goto('/');
  await page.waitForTimeout(PAUSE);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Login' });
  await page.waitForTimeout(PAUSE);
  await dialog.getByRole('button', { name: button }).click();
  await expect(page.getByRole('button', { name: 'Menu akun' })).toBeVisible();
}

test('Gate 3: gladi bersih skrip demo 13-DEMO-FLOW (video + trace)', async ({ browser }, testInfo) => {
  const outDir = testInfo.outputPath('recording');
  fs.mkdirSync(outDir, { recursive: true });
  const api = await Api.create(XFF);
  const studentApi = await api.loginDemo('student');
  const adminApi = await api.loginDemo('admin');
  // Persiapan langkah 8: campaign "normal" lain yang sudah ACTIVE dan punya dana.
  const normal = await createActiveCampaign(api, studentApi, adminApi, `Demo Normal Beasiswa ${Date.now().toString(36)}`);
  await donateAndPay(api, studentApi, normal.id, 300_000);

  const studentCtx = await recordedContext(browser, null, 'mahasiswa', outDir);
  const student = await studentCtx.newPage();
  let adminCtx: BrowserContext | null = null;
  let admin: Page | null = null;
  const title = `Demo Day Perpustakaan Keliling ${Date.now().toString(36)}`;
  let campaignId = '';
  let donationId = '';

  try {
    await log.run('D-1', async () => {
      await uiDemoLogin(student, 'Demo Mahasiswa');
      await shot(student, 'gate3-01-login');
      return 'Microsoft SSO belum ada → DEMO_MODE: login persona Mahasiswa (Budi Santoso) berhasil';
    });

    await log.run('D-2', async () => {
      await student.goto('/campaigns/new');
      await student.locator('#title').fill(title);
      await student.locator('#description').fill('Perpustakaan keliling untuk 5 desa: motor roda tiga, 300 buku, dan relawan pembaca setiap Sabtu.');
      await student.locator('#sdg').selectOption('QUALITY_EDUCATION');
      await student.locator('#target').fill('7500000');
      const deadline = new Date(Date.now() + 21 * 86_400_000);
      const iso = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
      await student.locator('#deadline').fill(iso);
      await student.waitForTimeout(PAUSE);
      await student.getByRole('button', { name: 'Simpan draft' }).click();
      await student.waitForURL(/\/campaigns\/[0-9a-f-]{36}\/edit$/);
      campaignId = /campaigns\/([0-9a-f-]{36})\/edit/.exec(student.url())![1];
      await student.locator('#proposal').setInputFiles(SAMPLE_PROPOSAL);
      await student.getByRole('button', { name: 'Unggah proposal' }).click();
      await expect(student.getByRole('button', { name: 'proposal-contoh.pdf' })).toBeVisible();
      await student.waitForTimeout(PAUSE);
      await student.getByRole('button', { name: 'Kirim untuk review admin' }).click();
      await student.waitForURL(new RegExp(`/campaigns/${campaignId}$`));
      const c = await api.ok<{ status: string; sdgCategory: string; targetAmount: number }>('GET', `/campaigns/${campaignId}`, { token: studentApi.token });
      expect(c.status).toBe('PENDING_REVIEW');
      await shot(student, 'gate3-02-campaign-pending-review');
      return `Campaign ${campaignId}: SDG ${c.sdgCategory}, target ${c.targetAmount}, deadline ${iso}, proposal PDF → ${c.status}`;
    });

    await log.run('D-3', async () => {
      adminCtx = await recordedContext(browser, null, 'admin', outDir);
      admin = await adminCtx.newPage();
      await uiDemoLogin(admin, 'Demo Admin');
      await admin.goto('/admin/reviews');
      const row = admin.getByRole('row').filter({ hasText: title });
      await row.getByRole('button', { name: 'Review' }).click();
      await admin.waitForTimeout(PAUSE);
      await admin.getByRole('button', { name: 'Setujui kampanye' }).click();
      await admin.getByRole('alertdialog').getByRole('button', { name: 'Ya, setujui' }).click();
      const c = await pollUntil(() => api.ok<{ status: string }>('GET', `/campaigns/${campaignId}`, { token: adminApi.token }), (v) => v.status === 'ACTIVE', 15_000, 500);
      // Setelah disetujui, campaign pindah dari tab Pending ke tab Approved.
      await admin.getByRole('tab', { name: /^Approved/ }).click();
      await admin.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Detail' }).click();
      await expect(admin.getByRole('link', { name: 'Buka halaman kampanye' })).toBeVisible();
      await shot(admin, 'gate3-03-admin-approve');
      return `Admin approve dari antrean review → ${c.status}`;
    });

    await log.run('D-4', async () => {
      await student.goto(`/campaigns/${campaignId}`);
      await student.locator('#amount').fill('100000');
      await student.waitForTimeout(PAUSE);
      await student.getByRole('button', { name: /Checkout via QRIS/ }).click();
      await student.waitForURL(/\/donations\/[0-9a-f-]{36}\/pay$/);
      donationId = /donations\/([0-9a-f-]{36})\/pay/.exec(student.url())![1];
      await expect(student.getByText('Scan QRIS untuk membayar')).toBeVisible();
      await shot(student, 'gate3-04-qris-mock');
      await student.getByRole('button', { name: 'Simulasi bayar berhasil' }).click();
      await expect(student.getByRole('status').filter({ hasText: 'Lunas' })).toBeVisible();
      const audit = await api.ok<{ logs: { action: string; metadata: { status?: string } }[] }>('GET', `/admin/audit-logs?action=PAYMENT_WEBHOOK_RECEIVED&entityId=${donationId}`, { token: adminApi.token });
      expect(audit.logs.some((l) => l.metadata.status === 'SETTLED')).toBe(true);
      return `Donasi ${donationId} Rp100.000; webhook mock SETTLED (audit PAYMENT_WEBHOOK_RECEIVED) → PAID`;
    });

    let detail: DonationDetail | undefined;
    await log.run('D-5', async () => {
      detail = await waitNotarized(api, studentApi.token, donationId);
      expect(detail.canonicalPayload).toMatch(/^v1\|/);
      expect(detail.hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(detail.blockchain!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      await student.getByRole('link', { name: 'Lihat bukti donasi' }).click();
      await student.waitForURL(new RegExp(`/donations/${donationId}$`));
      await expect(student.getByText(detail.canonicalPayload!).filter({ visible: true }).first()).toBeVisible();
      await expect(student.getByText(detail.blockchain!.txHash!).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
      return `payload ${detail.canonicalPayload}; hash ${detail.hash}; tx ${detail.blockchain!.txHash} blok ${detail.blockchain!.blockNumber}`;
    });

    await log.run('D-6', async () => {
      await expect(student.getByText(/^COCOK: hash dari data saat ini sama/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(student.getByRole('status').filter({ hasText: 'CONFIRMED' })).toBeVisible({ timeout: 30_000 });
      await scrollToTop(student.getByRole('heading', { name: 'Hash Database vs Hash On-chain' }));
      await shot(student, 'gate3-05-transparansi-cocok');
      await expect(student.getByRole('link', { name: /Lihat di block explorer/ })).toHaveCount(0);
      const proof = await api.ok<{ match: boolean; etherscanUrl: string | null }>('GET', `/donations/${donationId}/proof`);
      expect(proof.match).toBe(true);
      const after = await api.ok<{ integrityStatus: string }>('GET', `/donations/${donationId}`);
      return `COCOK (match=${proof.match}, integrityStatus=${after.integrityStatus}); txHash tampil; etherscanUrl=${proof.etherscanUrl} (chain lokal)`;
    });

    await log.run('D-7', async () => {
      const run = runDemoTamper(donationId, 900_000); // seperti demo: ubah DB, lalu jalankan integrity checker dari UI admin
      expect(run.exitCode, run.stderr).toBe(0);
      await admin!.goto(`/donations/${donationId}`);
      await admin!.waitForTimeout(PAUSE);
      await admin!.getByRole('button', { name: 'Verifikasi ke blockchain' }).click();
      await expect(admin!.getByText('Data donasi di database sudah diubah setelah dicatat ke blockchain. Campaign otomatis dibekukan dan pencairan dana dikunci.')).toBeVisible();
      await shot(admin!, 'gate3-06-tampered');
      const c = await api.ok<{ status: string }>('GET', `/campaigns/${campaignId}`);
      expect(c.status).toBe('FROZEN');
      const locked = await api.call('POST', `/campaigns/${campaignId}/disbursements`, {
        token: studentApi.token,
        multipart: { amount: '50000', description: 'Pencairan setelah tamper (harus terkunci)', proof: { name: 'b.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(SAMPLE_MILESTONE) } },
      });
      expect(locked.status).toBe(409);
      expect(locked.body.error?.code).toBe('CAMPAIGN_FROZEN');
      await student.goto(`/campaigns/${campaignId}`);
      await expect(student.getByText('Kampanye dibekukan: tidak menerima donasi dan pencairan dana terkunci.')).toBeVisible();
      await shot(student, 'gate3-07-frozen-locked');
      return `TAMPERED (verifikasi admin), campaign ${c.status}, pengajuan pencairan → ${locked.status} ${locked.body.error?.code}`;
    });

    await log.run('D-8', async () => {
      await student.goto(`/campaigns/${normal.id}/disburse`);
      await student.locator('#disb-desc').fill('Tahap 1: pembelian buku dan rak untuk perpustakaan keliling.');
      await student.locator('#disb-proof').setInputFiles(SAMPLE_MILESTONE);
      await student.waitForTimeout(PAUSE);
      await student.getByRole('button', { name: /^Ajukan tahap \d/ }).click();
      await expect(student.getByText('Pengajuan terkirim dan menunggu review admin.')).toBeVisible();
      await shot(student, 'gate3-08-ajukan-pencairan');
      await admin!.goto('/admin/disbursements');
      const row = admin!.getByRole('row').filter({ hasText: normal.title });
      await row.getByRole('button', { name: 'Review' }).click();
      await admin!.getByRole('button', { name: 'Setujui', exact: true }).click();
      await admin!.getByRole('alertdialog').getByRole('button', { name: 'Ya, setujui' }).click();
      await expect(admin!.getByRole('alertdialog')).toBeHidden();
      await admin!.getByRole('tab', { name: /^Approved/ }).click();
      await admin!.getByRole('row').filter({ hasText: normal.title }).getByRole('button', { name: 'Tandai paid' }).click();
      await admin!.getByRole('button', { name: 'Tandai transfer dibayar', exact: true }).click();
      await admin!.getByRole('alertdialog').getByRole('button', { name: 'Ya, tandai dibayar' }).click();
      await expect(admin!.getByRole('alertdialog')).toBeHidden();
      await admin!.getByRole('tab', { name: /^Paid/ }).click();
      await expect(admin!.getByRole('row').filter({ hasText: normal.title })).toBeVisible();
      await shot(admin!, 'gate3-09-pencairan-paid');
      const ms = await api.ok<{ completed: number; total: number }>('GET', `/campaigns/${normal.id}/milestones`);
      expect(ms.completed).toBe(1);
      return `Pencairan Rp100.000 di campaign normal: REQUESTED → APPROVED → PAID (milestone ${ms.completed}/${ms.total})`;
    });
  } finally {
    writeJson('gate3-dry-run-ids', { campaignId, donationId, normalCampaignId: normal.id, recordingDir: 'test-results/<test>/recording' });
    if (adminCtx) await closeRecorded(adminCtx);
    await closeRecorded(studentCtx);
    await api.dispose();
  }
});

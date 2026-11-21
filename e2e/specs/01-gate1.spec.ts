import { expect, type Page, test } from '@playwright/test';
import { Api, type DonationDetail, browserContextFor, pollUntil } from '../helpers/api';
import { SAMPLE_PROPOSAL } from '../helpers/env';
import { StepLog, scrollToTop, shot, writeJson } from '../helpers/evidence';

/**
 * Gate 1 (BFD-5 / BFD-66) — integrasi end-to-end lewat UI:
 * login demo mahasiswa → buat campaign + unggah proposal PDF → ajukan → login demo admin → setujui →
 * mahasiswa donasi → simulasi bayar (mock) → PAID → worker menotarisasi di Hardhat → CONFIRMED →
 * halaman bukti: hash on-chain = hash DB dan "COCOK".
 */
const XFF = '10.0.1.10';
const log = new StepLog('gate1-e2e', [
  { id: 'G1-01', name: 'Login demo mahasiswa (UI)', expected: 'Tombol "Demo Mahasiswa" → avatar akun Budi Santoso tampil' },
  { id: 'G1-02', name: 'Buat campaign (simpan draft)', expected: 'Draft tersimpan, URL /campaigns/:id/edit' },
  { id: 'G1-03', name: 'Unggah proposal PDF', expected: 'proposal-contoh.pdf tercantum di form' },
  { id: 'G1-04', name: 'Ajukan untuk review', expected: 'Status PENDING_REVIEW' },
  { id: 'G1-05', name: 'Login demo admin (UI) & setujui', expected: 'Status ACTIVE' },
  { id: 'G1-06', name: 'Mahasiswa donasi Rp100.000 (checkout QRIS mock)', expected: 'Halaman pembayaran dengan QRIS, status Menunggu pembayaran' },
  { id: 'G1-07', name: 'Simulasi bayar berhasil (webhook mock)', expected: 'Donasi PAID (badge "Lunas")' },
  { id: 'G1-08', name: 'Worker menotarisasi di Hardhat', expected: 'blockchain.status CONFIRMED, txHash & blockNumber terisi, chainId 31337' },
  { id: 'G1-09', name: 'Halaman bukti: hash on-chain = DB, COCOK', expected: 'Verdict "COCOK", hashOnChain = hashDb = currentHash, match=true' },
  { id: 'G1-10', name: 'Hitung ulang hash di browser', expected: '"Cocok dengan hash DB"' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

async function uiDemoLogin(page: Page, button: 'Demo Mahasiswa' | 'Demo Admin') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Login' });
  await expect(dialog.getByText('Mode demo aktif')).toBeVisible();
  await dialog.getByRole('button', { name: button }).click();
  await expect(page.getByRole('button', { name: 'Menu akun' })).toBeVisible();
}

test('Gate 1: alur campaign → donasi → notarisasi → bukti COCOK (UI)', async ({ browser }) => {
  const api = await Api.create(XFF);
  const studentCtx = await browserContextFor(browser, null, XFF);
  const student = await studentCtx.newPage();
  const title = `Gate1 Taman Baca ${Date.now().toString(36)}`;
  let campaignId = '';
  let donationId = '';

  await log.run('G1-01', async () => {
    await uiDemoLogin(student, 'Demo Mahasiswa');
    await student.getByRole('button', { name: 'Menu akun' }).click();
    await expect(student.getByText('budi.santoso@binus.ac.id')).toBeVisible();
    await shot(student, 'gate1-01-login-demo-mahasiswa');
    await student.keyboard.press('Escape');
    await student.getByRole('button', { name: 'Menu akun' }).click();
    return 'Login demo mahasiswa berhasil sebagai Budi Santoso (budi.santoso@binus.ac.id)';
  });

  await log.run('G1-02', async () => {
    await student.goto('/campaigns/new');
    await student.locator('#title').fill(title);
    await student.locator('#description').fill('Pojok baca untuk anak-anak di sekitar kampus: rak, 200 buku cerita, dan kegiatan membaca mingguan.');
    await student.locator('#sdg').selectOption('QUALITY_EDUCATION');
    await student.locator('#target').fill('2000000');
    await student.getByRole('button', { name: 'Simpan draft' }).click();
    await student.waitForURL(/\/campaigns\/[0-9a-f-]{36}\/edit$/);
    campaignId = /campaigns\/([0-9a-f-]{36})\/edit/.exec(student.url())![1];
    // Setelah simpan pertama, halaman pindah ke /edit (form dimuat ulang dari server).
    await expect(student.locator('#title')).toHaveValue(title);
    return `Draft ${campaignId} tersimpan`;
  });

  await log.run('G1-03', async () => {
    await student.locator('#proposal').setInputFiles(SAMPLE_PROPOSAL);
    await student.getByRole('button', { name: 'Unggah proposal' }).click();
    await expect(student.getByRole('button', { name: 'proposal-contoh.pdf' })).toBeVisible();
    await shot(student, 'gate1-02-campaign-proposal-diunggah');
    return 'proposal-contoh.pdf terunggah (STORAGE_DRIVER=db)';
  });

  await log.run('G1-04', async () => {
    await student.getByRole('button', { name: 'Kirim untuk review admin' }).click();
    await student.waitForURL(new RegExp(`/campaigns/${campaignId}$`));
    const c = await api.ok<{ status: string }>('GET', `/campaigns/${campaignId}`, { token: (await api.loginDemo('student')).token });
    expect(c.status).toBe('PENDING_REVIEW');
    await shot(student, 'gate1-03-campaign-pending-review');
    return `Status ${c.status}`;
  });

  await log.run('G1-05', async () => {
    const adminCtx = await browserContextFor(browser, null, XFF);
    const admin = await adminCtx.newPage();
    await uiDemoLogin(admin, 'Demo Admin');
    await admin.goto(`/campaigns/${campaignId}`);
    const panel = admin.getByRole('heading', { name: 'Panel Admin' }).locator('..');
    await panel.getByRole('button', { name: 'Setujui', exact: true }).click();
    await expect(panel.getByRole('button', { name: /Cek integritas semua donasi/ })).toBeVisible();
    const c = await pollUntil(() => api.ok<{ status: string }>('GET', `/campaigns/${campaignId}`), (v) => v.status === 'ACTIVE', 15_000, 500);
    await shot(admin, 'gate1-04-admin-setujui-active');
    await adminCtx.close();
    return `Admin menyetujui → status ${c.status}`;
  });

  await log.run('G1-06', async () => {
    await student.goto(`/campaigns/${campaignId}`);
    await student.locator('#amount').fill('100000');
    await student.getByRole('button', { name: /Checkout via QRIS/ }).click();
    await student.waitForURL(/\/donations\/[0-9a-f-]{36}\/pay$/);
    donationId = /donations\/([0-9a-f-]{36})\/pay/.exec(student.url())![1];
    await expect(student.getByText('Scan QRIS untuk membayar')).toBeVisible();
    await expect(student.getByRole('status').filter({ hasText: 'Menunggu pembayaran' })).toBeVisible();
    await shot(student, 'gate1-05-pembayaran-qris-mock');
    return `Donasi ${donationId} PENDING, QRIS mock tampil`;
  });

  await log.run('G1-07', async () => {
    await student.getByRole('button', { name: 'Simulasi bayar berhasil' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'Lunas' })).toBeVisible();
    await shot(student, 'gate1-06-donasi-paid');
    return 'Webhook mock bertanda tangan diterima → donasi PAID';
  });

  let detail: DonationDetail | undefined;
  await log.run('G1-08', async () => {
    detail = await pollUntil(
      () => api.ok<DonationDetail>('GET', `/donations/${donationId}`),
      (d) => d.blockchain?.status === 'CONFIRMED' || d.blockchain?.status === 'FAILED',
      120_000,
      1500,
    );
    expect(detail.blockchain?.status).toBe('CONFIRMED');
    expect(detail.blockchain?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(detail.blockchain?.chainId).toBe(31337);
    expect(detail.hash).toMatch(/^0x[0-9a-f]{64}$/);
    return `CONFIRMED tx ${detail.blockchain!.txHash} blok ${detail.blockchain!.blockNumber} (chain ${detail.blockchain!.chainId})`;
  });

  await log.run('G1-09', async () => {
    await student.getByRole('link', { name: 'Lihat bukti donasi' }).click();
    await student.waitForURL(new RegExp(`/donations/${donationId}$`));
    await expect(student.getByText(/^COCOK: hash dari data saat ini sama dengan hash di blockchain\./).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const proof = await api.ok<{ hashDb: string; hashOnChain: string; currentHash: string; match: boolean; txHash: string }>('GET', `/donations/${donationId}/proof`);
    expect(proof.match).toBe(true);
    expect(proof.hashOnChain).toBe(proof.hashDb);
    expect(proof.currentHash).toBe(proof.hashDb);
    expect(proof.hashDb).toBe(detail!.hash);
    await expect(student.getByText(proof.hashOnChain).filter({ visible: true }).first()).toBeVisible();
    await expect(student.getByRole('status').filter({ hasText: 'CONFIRMED' })).toBeVisible({ timeout: 30_000 });
    await scrollToTop(student.getByRole('heading', { name: 'Hash Database vs Hash On-chain' }));
    await shot(student, 'gate1-07-bukti-cocok-onchain');
    writeJson('gate1-proof', { campaignId, donationId, donation: detail, proof });
    return `hashDb = hashOnChain = currentHash = ${proof.hashDb}; match=true; UI "COCOK"`;
  });

  await log.run('G1-10', async () => {
    await student.getByRole('button', { name: 'Hitung ulang hash di browser' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'Cocok dengan hash DB' })).toBeVisible();
    await scrollToTop(student.getByRole('heading', { name: 'Payload & Hash Bukti' }));
    await shot(student, 'gate1-08-hash-browser-cocok');
    return 'Keccak-256 payload di browser = hash DB';
  });

  await studentCtx.close();
  await api.dispose();
});

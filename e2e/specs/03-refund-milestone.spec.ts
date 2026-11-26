import { expect, type Page, test } from '@playwright/test';
import { Api, type Session, browserContextFor, requestDisbursement } from '../helpers/api';
import { SAMPLE_MILESTONE } from '../helpers/env';
import { StepLog, shot, writeJson } from '../helpers/evidence';

/**
 * BFD-65: E2E refund & milestone.
 * Memakai data seed: "Air Bersih untuk Desa Sukamaju" (ACTIVE, milik Budi; milestone 1 PAID,
 * milestone 2 REQUESTED) dan "Kebun Hidroponik Rusun Marunda" (FROZEN, donasi PAID Budi Rp200.000).
 */
const XFF = '10.0.3.10';

const log = new StepLog('bfd65-refund-milestone', [
  { id: 'M-01', name: 'Status awal milestone (seed)', expected: '1 selesai, tahap 2 REQUESTED berjalan, canRequestNext=false' },
  { id: 'M-02', name: 'Milestone berikutnya diblokir selama ada yang terbuka', expected: '409 DISBURSEMENT_IN_PROGRESS' },
  { id: 'M-03', name: 'Admin setujui milestone 2 (UI)', expected: 'Status APPROVED' },
  { id: 'M-04', name: 'Admin tandai transfer dibayar (UI)', expected: 'Status PAID; 2 dari 2 selesai' },
  { id: 'M-05', name: 'Mahasiswa ajukan milestone 3 dengan bukti (UI)', expected: '"Pengajuan terkirim", status REQUESTED' },
  { id: 'M-06', name: 'Milestone 4 diblokir selama milestone 3 terbuka', expected: '409 DISBURSEMENT_IN_PROGRESS' },
  { id: 'M-07', name: 'Approve + mark paid milestone 3, progres milestone', expected: '3 dari 3 selesai, canRequestNext=true; UI "3 dari 3 selesai"' },
  { id: 'R-01', name: 'Refund ditolak di campaign ACTIVE', expected: '409 REFUND_CAMPAIGN_NOT_FROZEN' },
  { id: 'R-02', name: 'Validasi alasan refund', expected: '400 VALIDATION_ERROR untuk alasan < 5 karakter' },
  { id: 'R-03', name: 'Refund donasi PAID di campaign FROZEN', expected: '200 status REFUNDED; saldo campaign berkurang; audit DONATION_REFUNDED' },
  { id: 'R-04', name: 'Refund ganda ditolak', expected: '409 DONATION_NOT_REFUNDABLE' },
  { id: 'R-05', name: 'Halaman pembayaran menampilkan REFUNDED', expected: 'Badge "Dana dikembalikan" + catatan refund untuk donatur' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

interface Milestones {
  steps: { id: string; step: number; status: string; description: string; amount: number }[];
  completed: number;
  total: number;
  current: { step: number; status: string } | null;
  canRequestNext: boolean;
}

async function adminDecideInUi(page: Page, rowText: string, action: 'approve' | 'mark-paid', shotName: string) {
  await page.goto('/admin/disbursements');
  if (action === 'mark-paid') await page.getByRole('tab', { name: /^Approved/ }).click();
  const row = page.getByRole('row').filter({ hasText: rowText });
  await row.getByRole('button', { name: action === 'approve' ? 'Review' : 'Tandai paid' }).click();
  await page.getByRole('button', { name: action === 'approve' ? 'Setujui' : 'Tandai transfer dibayar', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await shot(page, shotName);
  await dialog.getByRole('button', { name: action === 'approve' ? 'Ya, setujui' : 'Ya, tandai dibayar' }).click();
  await expect(dialog).toBeHidden();
}

test('BFD-65: milestone bertahap & refund campaign FROZEN', async ({ browser }) => {
  const api = await Api.create(XFF);
  const student: Session = await api.loginDemo('student');
  const admin: Session = await api.loginDemo('admin');
  const all = await api.ok<{ campaigns: { id: string; title: string; status: string; currentAmount: number }[] }>('GET', '/admin/campaigns?status=ALL&limit=100', { token: admin.token });
  const water = all.campaigns.find((c) => c.title === 'Air Bersih untuk Desa Sukamaju');
  const hydro = all.campaigns.find((c) => c.title === 'Kebun Hidroponik Rusun Marunda');
  expect(water, 'campaign seed Air Bersih').toBeTruthy();
  expect(hydro, 'campaign seed Hidroponik').toBeTruthy();
  const milestones = () => api.ok<Milestones>('GET', `/campaigns/${water!.id}/milestones`);

  const adminCtx = await browserContextFor(browser, admin, XFF);
  const adminPage = await adminCtx.newPage();
  const studentCtx = await browserContextFor(browser, student, XFF);
  const studentPage = await studentCtx.newPage();

  await log.run('M-01', async () => {
    const m = await milestones();
    expect(m.completed).toBe(1);
    expect(m.current?.step).toBe(2);
    expect(m.current?.status).toBe('REQUESTED');
    expect(m.canRequestNext).toBe(false);
    writeJson('bfd65-milestones-awal', m);
    return `${m.completed} dari ${m.total} selesai, tahap ${m.current!.step} ${m.current!.status}, canRequestNext=${m.canRequestNext}`;
  });

  await log.run('M-02', async () => {
    const r = await requestDisbursement(api, student, water!.id, 50_000, 'Milestone tambahan saat tahap 2 masih berjalan');
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('DISBURSEMENT_IN_PROGRESS');
    return `${r.status} ${r.body.error?.code}`;
  });

  await log.run('M-03', async () => {
    await adminDecideInUi(adminPage, 'Milestone 2: filter air', 'approve', 'bfd65-01-admin-setujui-milestone2');
    const m = await milestones();
    expect(m.steps.find((s) => s.step === 2)?.status).toBe('APPROVED');
    return 'Milestone 2 APPROVED lewat UI admin';
  });

  await log.run('M-04', async () => {
    await adminDecideInUi(adminPage, 'Milestone 2: filter air', 'mark-paid', 'bfd65-02-admin-tandai-dibayar');
    const m = await milestones();
    expect(m.steps.find((s) => s.step === 2)?.status).toBe('PAID');
    expect(m.completed).toBe(2);
    expect(m.canRequestNext).toBe(true);
    return `Milestone 2 PAID; ${m.completed} dari ${m.total} selesai; canRequestNext=${m.canRequestNext}`;
  });

  let m3Id = '';
  await log.run('M-05', async () => {
    // Nominal tahap dihitung backend (20/40/60/80/100% dana terkumpul), tidak diisi di form.
    const before = await api.ok<{ funds: { nextTranche: { step: number; amount: number } | null } }>('GET', `/campaigns/${water!.id}`, { token: student.token });
    const amount = before.funds.nextTranche?.amount ?? 0;
    expect(amount).toBeGreaterThan(0);
    await studentPage.goto(`/campaigns/${water!.id}/disburse`);
    await studentPage.locator('#disb-desc').fill('Milestone 3: cat tandon dan papan informasi perawatan untuk warga.');
    await studentPage.locator('#disb-proof').setInputFiles(SAMPLE_MILESTONE);
    await studentPage.getByRole('button', { name: /^Ajukan tahap \d/ }).click();
    await expect(studentPage.getByText('Pengajuan terkirim dan menunggu review admin.')).toBeVisible();
    await shot(studentPage, 'bfd65-03-mahasiswa-ajukan-milestone3');
    const m = await milestones();
    const m3 = m.steps.find((s) => s.description.startsWith('Milestone 3'));
    expect(m3?.status).toBe('REQUESTED');
    m3Id = m3!.id;
    return `Milestone 3 (${amount}) REQUESTED lewat UI dengan bukti PDF`;
  });

  await log.run('M-06', async () => {
    const r = await requestDisbursement(api, student, water!.id, 10_000, 'Milestone 4 saat milestone 3 belum dibayar');
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('DISBURSEMENT_IN_PROGRESS');
    return `${r.status} ${r.body.error?.code}`;
  });

  await log.run('M-07', async () => {
    await api.ok('POST', `/admin/disbursements/${m3Id}/approve`, { token: admin.token });
    await api.ok('POST', `/admin/disbursements/${m3Id}/mark-paid`, { token: admin.token });
    const m = await milestones();
    expect(m.completed).toBe(3);
    expect(m.total).toBe(3);
    expect(m.canRequestNext).toBe(true);
    await studentPage.goto(`/campaigns/${water!.id}`);
    await studentPage.getByRole('tab', { name: 'Milestone & Dana' }).click();
    await expect(studentPage.getByText('3 dari 3 selesai')).toBeVisible();
    await studentPage.getByText('Tahapan milestone').scrollIntoViewIfNeeded();
    await shot(studentPage, 'bfd65-04-progres-milestone');
    writeJson('bfd65-milestones-akhir', m);
    return `${m.completed} dari ${m.total} selesai, canRequestNext=${m.canRequestNext}`;
  });

  await log.run('R-01', async () => {
    const donations = await api.ok<{ id: string; amount: number; donor: { name: string } }[]>('GET', `/admin/donations?campaignId=${water!.id}`, { token: admin.token });
    const target = donations[0];
    expect(target).toBeTruthy();
    const r = await api.call('POST', `/admin/donations/${target.id}/refund`, { token: admin.token, data: { reason: 'Uji refund di campaign ACTIVE harus ditolak' } });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('REFUND_CAMPAIGN_NOT_FROZEN');
    const still = await api.ok<{ status: string }>('GET', `/donations/${target.id}`, { token: admin.token });
    expect(still.status).toBe('PAID');
    return `${r.status} ${r.body.error?.code}; donasi tetap ${still.status}`;
  });

  const mine = await api.ok<{ id: string; amount: number; status: string; campaign: { id: string } }[]>('GET', '/me/donations', { token: student.token });
  const refundTarget = mine.find((d) => d.campaign.id === hydro!.id && d.status === 'PAID');

  await log.run('R-02', async () => {
    expect(refundTarget, 'donasi PAID Budi di campaign FROZEN (seed)').toBeTruthy();
    const r = await api.call('POST', `/admin/donations/${refundTarget!.id}/refund`, { token: admin.token, data: { reason: 'abc' } });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('VALIDATION_ERROR');
    return `${r.status} ${r.body.error?.code}: ${r.body.error?.message}`;
  });

  await log.run('R-03', async () => {
    const before = await api.ok<{ status: string; currentAmount: number }>('GET', `/campaigns/${hydro!.id}`, { token: admin.token });
    expect(before.status).toBe('FROZEN');
    const r = await api.call<{ status: string }>('POST', `/admin/donations/${refundTarget!.id}/refund`, {
      token: admin.token,
      data: { reason: 'Campaign dibekukan; dana dikembalikan manual ke donatur (QA BFD-65)' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data!.status).toBe('REFUNDED');
    const after = await api.ok<{ currentAmount: number }>('GET', `/campaigns/${hydro!.id}`, { token: admin.token });
    expect(after.currentAmount).toBe(before.currentAmount - refundTarget!.amount);
    const audit = await api.ok<{ logs: { action: string; metadata: Record<string, unknown> }[] }>('GET', `/admin/audit-logs?action=DONATION_REFUNDED&entityId=${refundTarget!.id}`, { token: admin.token });
    expect(audit.logs.length).toBe(1);
    writeJson('bfd65-refund', { donationId: refundTarget!.id, response: r.body.data, campaignAmountBefore: before.currentAmount, campaignAmountAfter: after.currentAmount, audit: audit.logs[0] });
    return `REFUNDED; saldo campaign ${before.currentAmount} → ${after.currentAmount}; audit DONATION_REFUNDED tercatat`;
  });

  await log.run('R-04', async () => {
    const r = await api.call('POST', `/admin/donations/${refundTarget!.id}/refund`, { token: admin.token, data: { reason: 'Refund kedua harus ditolak' } });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('DONATION_NOT_REFUNDABLE');
    return `${r.status} ${r.body.error?.code}`;
  });

  await log.run('R-05', async () => {
    await studentPage.goto(`/donations/${refundTarget!.id}/pay`);
    await expect(studentPage.getByRole('status').filter({ hasText: 'Dana dikembalikan' }).first()).toBeVisible();
    await expect(studentPage.getByText(/telah di-refund ke donatur/)).toBeVisible();
    await shot(studentPage, 'bfd65-05-pembayaran-refunded');
    return 'Halaman pembayaran donatur: "Dana dikembalikan" + penjelasan refund';
  });

  await adminCtx.close();
  await studentCtx.close();
  await api.dispose();
});

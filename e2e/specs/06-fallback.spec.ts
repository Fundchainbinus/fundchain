import { expect, test } from '@playwright/test';
import { Api, browserContextFor, createActiveCampaign, donateAndPay, waitNotarized } from '../helpers/api';
import { StepLog, shot, writeJson } from '../helpers/evidence';

/**
 * BFD-71: matriks fallback yang bisa diotomasi.
 *  - Pakasir/gateway → PAYMENT_PROVIDER=mock (simulasi bayar)
 *  - Sepolia → BLOCKCHAIN_NETWORK=localhost (Hardhat 31337)
 *  - SSO/Google → DEMO_MODE (login persona) saat Google tidak tersedia (GOOGLE_CLIENT_ID kosong)
 */
const XFF = '10.0.6.10';

const log = new StepLog('bfd71-fallback', [
  { id: 'F-01', name: 'Fallback pembayaran: gateway=mock', expected: '/config paymentProvider=mock; donasi + simulasi settlement → PAID; UI menampilkan "Mock payment · mode demo"' },
  { id: 'F-02', name: 'Fallback chain: localhost (Hardhat)', expected: '/blockchain/info network=localhost chainId=31337 ready=true; donasi CONFIRMED di 31337 tanpa link Etherscan' },
  { id: 'F-03', name: 'Google tidak tersedia → POST /auth/google ditolak rapi', expected: '401 AUTH_UNAUTHENTICATED "Login Google belum dikonfigurasi di server."' },
  { id: 'F-04', name: 'DEMO_MODE login saat Google tidak tersedia (UI)', expected: 'Tombol Google menampilkan error; "Demo Mahasiswa" tetap berhasil login' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

test('BFD-71: fallback mock payment, chain lokal, DEMO_MODE', async ({ browser }) => {
  const api = await Api.create(XFF);
  const student = await api.loginDemo('student');
  const admin = await api.loginDemo('admin');
  let campaignId = '';
  let donationId = '';

  await log.run('F-01', async () => {
    const cfg = await api.ok<{ paymentProvider: string; devTools: boolean }>('GET', '/config');
    expect(cfg.paymentProvider).toBe('mock');
    expect(cfg.devTools).toBe(true);
    const c = await createActiveCampaign(api, student, admin, `Fallback Mock ${Date.now().toString(36)}`);
    campaignId = c.id;
    donationId = await donateAndPay(api, student, campaignId, 25_000);
    const d = await api.ok<{ status: string; payment: { provider: string; status: string } }>('GET', `/donations/${donationId}`, { token: student.token });
    expect(d.status).toBe('PAID');
    expect(d.payment.provider).toBe('mock');
    expect(d.payment.status).toBe('SETTLED');
    const ctx = await browserContextFor(browser, student, XFF);
    const page = await ctx.newPage();
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.locator('#method')).toContainText('Mock payment · mode demo');
    await expect(page.getByRole('button', { name: /Simulasikan pembayaran berhasil/ })).toBeVisible();
    await page.locator('#method').scrollIntoViewIfNeeded();
    await shot(page, 'bfd71-01-mock-payment');
    await ctx.close();
    return `provider=mock; donasi ${donationId} PAID (payment SETTLED) lewat simulasi`;
  });

  await log.run('F-02', async () => {
    const info = await api.ok<{ network: string; chainId: number; ready: boolean; contractAddress: string; explorerUrl: string | null }>('GET', '/blockchain/info');
    expect(info.network).toBe('localhost');
    expect(info.chainId).toBe(31337);
    expect(info.ready).toBe(true);
    const d = await waitNotarized(api, student.token, donationId);
    expect(d.blockchain!.chainId).toBe(31337);
    expect(d.blockchain!.network).toBe('localhost');
    expect(d.blockchain!.explorerUrl).toBeNull();
    writeJson('bfd71-chain-info', { info, donation: { id: d.id, blockchain: d.blockchain } });
    return `network=${info.network} chainId=${info.chainId} ready=${info.ready}; donasi CONFIRMED tx ${d.blockchain!.txHash} (tanpa explorer)`;
  });

  await log.run('F-03', async () => {
    const cfg = await api.ok<{ googleClientId: string; demoMode: boolean }>('GET', '/config');
    expect(cfg.googleClientId).toBe('');
    expect(cfg.demoMode).toBe(true);
    const r = await api.call('POST', '/auth/google', { data: { accessToken: 'token-google-tidak-tersedia' } });
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe('AUTH_UNAUTHENTICATED');
    expect(r.body.error?.message).toContain('belum dikonfigurasi');
    return `${r.status} ${r.body.error?.code}: ${r.body.error?.message}`;
  });

  await log.run('F-04', async () => {
    const ctx = await browserContextFor(browser, null, XFF);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Login' });
    await dialog.getByRole('button', { name: /Login dengan Google/ }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Login Google belum dikonfigurasi.');
    await shot(page, 'bfd71-02-google-tidak-tersedia');
    await dialog.getByRole('button', { name: 'Demo Mahasiswa' }).click();
    await expect(page.getByRole('button', { name: 'Menu akun' })).toBeVisible();
    await page.getByRole('button', { name: 'Menu akun' }).click();
    await expect(page.getByText('budi.santoso@binus.ac.id')).toBeVisible();
    await shot(page, 'bfd71-03-demo-login-berhasil');
    await ctx.close();
    return 'Login Google menampilkan "Login Google belum dikonfigurasi."; login Demo Mahasiswa berhasil';
  });

  await api.dispose();
});

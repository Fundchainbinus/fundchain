import { expect, test } from '@playwright/test';
import {
  Api,
  type Session,
  browserContextFor,
  createActiveCampaign,
  donateAndPay,
  pollUntil,
  requestDisbursement,
  waitNotarized,
} from '../helpers/api';
import { StepLog, scrollToTop, shot, writeJson } from '../helpers/evidence';
import { runDemoTamper } from '../helpers/tamper';

/**
 * Gate 2 (BFD-67) + BFD-53: simulasi tamper → TAMPERED → campaign FROZEN → pencairan terkunci,
 * unfreeze ditolak selama masih TAMPERED, lalu pulih setelah data dikembalikan. Ditambah bukti bahwa
 * hash checker otomatis (worker) mendeteksi tamper TANPA klik admin.
 */
const XFF = '10.0.2.10';
const ORIGINAL = 100_000;
const TAMPERED = 900_000;

const log = new StepLog('gate2-tamper', [
  { id: 'G2-01', name: 'Siapkan campaign ACTIVE + donasi Rp100.000 CONFIRMED + pengajuan pencairan REQUESTED', expected: 'Donasi CONFIRMED, match=true; pencairan REQUESTED' },
  { id: 'G2-02', name: 'demo:tamper --json (100.000 → 900.000)', expected: '{status: TAMPERED, currentHash != onChainHash, campaignFrozen: true}' },
  { id: 'G2-03', name: 'API: campaign FROZEN & proof match=false', expected: 'GET /campaigns/:id status FROZEN; /proof match=false, currentHash != hashOnChain' },
  { id: 'G2-04', name: 'Pencairan terkunci', expected: 'Ajukan baru → 409 CAMPAIGN_FROZEN; approve pengajuan lama → 409 CAMPAIGN_FROZEN' },
  { id: 'G2-05', name: 'Audit log INTEGRITY_TAMPERED + CAMPAIGN_FROZEN', expected: 'metadata berisi source, storedHash/currentHash/onChainHash; IP & User-Agent tercatat' },
  { id: 'G2-06', name: 'UI: halaman bukti TAMPERED & banner FROZEN', expected: 'Verdict "TAMPERED: ..." dan campaign FROZEN tampil' },
  { id: 'G2-07', name: 'Unfreeze ditolak selama TAMPERED', expected: '409 CAMPAIGN_FROZEN "Masih ada 1 donasi TAMPERED"' },
  { id: 'G2-08', name: 'Pulihkan nominal (demo:tamper 100.000 --json) lalu unfreeze', expected: 'status VERIFIED, unfreeze → ACTIVE' },
  { id: 'G2-09', name: 'Hash checker otomatis tanpa klik admin', expected: 'Tamper tanpa --check → worker (source SCHEDULED) menandai TAMPERED & FROZEN dalam ≤ 150 dtk' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

test('Gate 2: tamper → TAMPERED → FROZEN → pencairan terkunci → pulih', async ({ browser }) => {
  const api = await Api.create(XFF);
  const student: Session = await api.loginDemo('student');
  const admin: Session = await api.loginDemo('admin');
  let campaignId = '';
  let donationId = '';
  let disbursementId = '';

  await log.run('G2-01', async () => {
    const c = await createActiveCampaign(api, student, admin, `Gate2 Tamper ${Date.now().toString(36)}`);
    campaignId = c.id;
    donationId = await donateAndPay(api, student, campaignId, ORIGINAL);
    const d = await waitNotarized(api, student.token, donationId);
    const proof = await api.ok<{ match: boolean }>('GET', `/donations/${donationId}/proof`);
    expect(proof.match).toBe(true);
    const disb = await requestDisbursement(api, student, campaignId, 50_000, 'Pengadaan rak buku tahap pertama sebelum tamper');
    expect(disb.status, JSON.stringify(disb.body)).toBe(201);
    disbursementId = disb.body.data!.id;
    return `campaign ${campaignId} ACTIVE; donasi ${donationId} CONFIRMED tx ${d.blockchain!.txHash}; pencairan ${disbursementId} REQUESTED`;
  });

  await log.run('G2-02', async () => {
    const run = runDemoTamper(donationId, TAMPERED, { json: true });
    writeJson('gate2-demo-tamper', { command: run.command.replace(donationId, '<donationId>'), donationId, exitCode: run.exitCode, json: run.json, stderrTail: run.stderr.slice(-1500) });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.json).not.toBeNull();
    expect(run.json!.status).toBe('TAMPERED');
    expect(run.json!.currentHash).not.toBe(run.json!.onChainHash);
    expect(run.json!.campaignFrozen).toBe(true);
    return JSON.stringify(run.json);
  });

  await log.run('G2-03', async () => {
    const c = await api.ok<{ status: string; frozenReason: string | null }>('GET', `/campaigns/${campaignId}`);
    expect(c.status).toBe('FROZEN');
    const proof = await api.ok<{ match: boolean; currentHash: string; hashOnChain: string; hashDb: string }>('GET', `/donations/${donationId}/proof`);
    expect(proof.match).toBe(false);
    expect(proof.currentHash).not.toBe(proof.hashOnChain);
    expect(proof.hashDb).toBe(proof.hashOnChain);
    writeJson('gate2-proof-tampered', { campaign: c, proof });
    return `campaign FROZEN (${c.frozenReason}); proof match=false, currentHash ${proof.currentHash} != hashOnChain ${proof.hashOnChain}`;
  });

  await log.run('G2-04', async () => {
    const newReq = await requestDisbursement(api, student, campaignId, 10_000, 'Pengajuan setelah tamper harus ditolak sistem');
    expect(newReq.status).toBe(409);
    expect(newReq.body.error?.code).toBe('CAMPAIGN_FROZEN');
    const approve = await api.call('POST', `/admin/disbursements/${disbursementId}/approve`, { token: admin.token });
    expect(approve.status).toBe(409);
    expect(approve.body.error?.code).toBe('CAMPAIGN_FROZEN');
    return `ajukan baru → ${newReq.status} ${newReq.body.error?.code}; approve pengajuan lama → ${approve.status} ${approve.body.error?.code}`;
  });

  await log.run('G2-05', async () => {
    const logs = await api.ok<{ logs: { action: string; metadata: Record<string, unknown>; ipAddress: string | null; userAgent: string | null }[] }>(
      'GET',
      `/admin/audit-logs?action=INTEGRITY_TAMPERED&entityId=${donationId}`,
      { token: admin.token },
    );
    const entry = logs.logs.find((l) => l.action === 'INTEGRITY_TAMPERED');
    expect(entry, JSON.stringify(logs)).toBeTruthy();
    expect(entry!.metadata).toMatchObject({ campaignId });
    expect(entry!.metadata.source).toBeTruthy();
    expect(entry!.metadata.currentHash).toBeTruthy();
    expect(entry!.metadata.onChainHash).toBeTruthy();
    expect(entry!.metadata.storedHash).toBeTruthy();
    const frozen = await api.ok<{ logs: { action: string; metadata: Record<string, unknown> }[] }>(
      'GET',
      `/admin/audit-logs?action=CAMPAIGN_FROZEN&entityId=${campaignId}`,
      { token: admin.token },
    );
    expect(frozen.logs.length).toBeGreaterThan(0);
    // Sumber pengecekan --json adalah script (CLI), jadi IP/UA kosong; IP & UA diuji di jalur manual admin di bawah.
    const manual = await api.call<{ status: string }>('POST', `/admin/donations/${donationId}/verify`, {
      token: admin.token,
      headers: { 'User-Agent': 'FundChain-QA-E2E/1.0' },
    });
    expect(manual.status).toBe(200);
    expect(manual.body.data!.status).toBe('TAMPERED');
    const after = await api.ok<{ logs: { action: string; metadata: Record<string, unknown>; ipAddress: string | null; userAgent: string | null }[] }>(
      'GET',
      `/admin/audit-logs?action=INTEGRITY_TAMPERED&entityId=${donationId}`,
      { token: admin.token },
    );
    const manualEntry = after.logs.find((l) => l.metadata.source === 'MANUAL');
    expect(manualEntry, JSON.stringify(after.logs.map((l) => l.metadata.source))).toBeTruthy();
    expect(manualEntry!.ipAddress).toBe(XFF);
    expect(manualEntry!.userAgent).toBe('FundChain-QA-E2E/1.0');
    writeJson('gate2-audit-integrity-tampered', { firstDetection: entry, manualCheck: manualEntry, campaignFrozen: frozen.logs[0] });
    return `INTEGRITY_TAMPERED source=${entry!.metadata.source} (script) & MANUAL (IP ${manualEntry!.ipAddress}, UA ${manualEntry!.userAgent}); CAMPAIGN_FROZEN tercatat`;
  });

  await log.run('G2-06', async () => {
    const ctx = await browserContextFor(browser, admin, XFF);
    const page = await ctx.newPage();
    await page.goto(`/donations/${donationId}`);
    await expect(page.getByText(/^TAMPERED: hash dari data saat ini TIDAK sama/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await scrollToTop(page.getByRole('heading', { name: 'Hash Database vs Hash On-chain' }));
    await shot(page, 'gate2-01-bukti-tampered');
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByText('Kampanye dibekukan: tidak menerima donasi dan pencairan dana terkunci.')).toBeVisible();
    await shot(page, 'gate2-02-campaign-frozen');
    await ctx.close();
    return 'UI bukti donasi menampilkan TAMPERED; halaman campaign menampilkan status dibekukan';
  });

  await log.run('G2-07', async () => {
    const r = await api.call('POST', `/admin/campaigns/${campaignId}/unfreeze`, { token: admin.token, data: { reason: 'Coba cabut pembekuan sebelum data dipulihkan' } });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('CAMPAIGN_FROZEN');
    expect(r.body.error?.message).toContain('TAMPERED');
    return `${r.status} ${r.body.error?.code}: ${r.body.error?.message}`;
  });

  await log.run('G2-08', async () => {
    const run = runDemoTamper(donationId, ORIGINAL, { json: true });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.json!.status).toBe('VERIFIED');
    expect(run.json!.currentHash).toBe(run.json!.onChainHash);
    const r = await api.call<{ status: string }>('POST', `/admin/campaigns/${campaignId}/unfreeze`, {
      token: admin.token,
      data: { reason: 'Data donasi dipulihkan dan terverifikasi ulang (QA Gate 2)' },
    });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    const c = await api.ok<{ status: string }>('GET', `/campaigns/${campaignId}`);
    expect(c.status).toBe('ACTIVE');
    writeJson('gate2-restore', { restoreJson: run.json, unfreezeStatus: r.status, campaignStatus: c.status });
    return `restore → ${JSON.stringify(run.json)}; unfreeze ${r.status} → campaign ${c.status}`;
  });

  await log.run('G2-09', async () => {
    const c2 = await createActiveCampaign(api, student, admin, `Gate2 AutoCheck ${Date.now().toString(36)}`);
    const d2 = await donateAndPay(api, student, c2.id, 150_000);
    await waitNotarized(api, student.token, d2);
    const run = runDemoTamper(d2, 777_000); // tanpa --check / --json: TIDAK ada pengecekan dari script
    expect(run.exitCode, run.stderr).toBe(0);
    const tamperedAt = Date.now();
    // Tidak ada panggilan verify admin di sini — hanya membaca status publik.
    const frozen = await pollUntil(
      () => api.ok<{ status: string }>('GET', `/campaigns/${c2.id}`),
      (c) => c.status === 'FROZEN',
      150_000,
      5_000,
    );
    const detectSeconds = Math.round((Date.now() - tamperedAt) / 1000);
    const logs = await api.ok<{ logs: { action: string; actor: unknown; metadata: Record<string, unknown> }[] }>(
      'GET',
      `/admin/audit-logs?action=INTEGRITY_TAMPERED&entityId=${d2}`,
      { token: admin.token },
    );
    expect(logs.logs.length).toBeGreaterThan(0);
    const sources = logs.logs.map((l) => l.metadata.source);
    expect(sources).toContain('SCHEDULED');
    expect(sources).not.toContain('MANUAL');
    writeJson('gate2-auto-checker', { campaignId: c2.id, donationId: d2, detectSeconds, campaignStatus: frozen.status, auditSources: sources, auditEntry: logs.logs[0] });
    return `Worker menandai TAMPERED (source SCHEDULED) & campaign FROZEN ±${detectSeconds} dtk setelah tamper, tanpa klik admin`;
  });

  await api.dispose();
});

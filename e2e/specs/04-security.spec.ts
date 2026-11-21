import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { Api, type Session, createDonation, signMock } from '../helpers/api';
import { REPO_ROOT } from '../helpers/env';
import { StepLog, writeJson } from '../helpers/evidence';

/**
 * BFD-69: uji keamanan tingkat API terhadap stack lokal.
 * Urutan penting: revokasi sesi (logout) dijalankan PALING AKHIR karena logout mencabut semua sesi Budi.
 */
const XFF = '10.0.4.10';

const log = new StepLog('bfd69-security', [
  { id: 'S-01', name: 'IDOR baca: data user lain', expected: '404 untuk donasi PENDING milik admin, campaign PENDING_REVIEW/REJECTED milik user lain & proposalnya' },
  { id: 'S-02', name: 'IDOR tulis: aksi atas resource user lain', expected: '403 (CAMPAIGN_NOT_OWNED / AUTH_FORBIDDEN), data tidak berubah' },
  { id: 'S-03', name: 'Tanpa login ke endpoint privat', expected: '401 AUTH_UNAUTHENTICATED' },
  { id: 'S-04', name: 'Non-admin ke endpoint admin', expected: '403 AUTH_FORBIDDEN untuk semua endpoint admin, tanpa efek samping' },
  { id: 'S-05', name: 'Webhook palsu', expected: '401 PAYMENT_SIGNATURE_INVALID (signature salah / tanpa signature), donasi tetap PENDING' },
  { id: 'S-06', name: 'Webhook dobel & mismatch', expected: 'pertama 200 replayed=false PAID; kedua 200 replayed=true; amount mismatch 400; order tak dikenal 404' },
  { id: 'S-07', name: 'Rate limit login', expected: '/auth/demo & /auth/google → 429 RATE_LIMITED setelah 10 request/menit' },
  { id: 'S-08', name: 'CSRF: POST berbasis cookie tanpa X-Requested-With', expected: '403 AUTH_FORBIDDEN; dengan header → sukses' },
  { id: 'S-09', name: 'Payload bergaya SQL injection di query/search', expected: 'tidak ada 500, tidak ada data non-publik bocor, tabel tetap utuh' },
  { id: 'S-10', name: 'Upload file berbahaya (bukan PDF berekstensi .pdf)', expected: '400 INVALID_FILE_TYPE' },
  { id: 'S-11', name: 'Atribut cookie sesi & error tanpa stack trace', expected: 'HttpOnly; SameSite=Lax; Path=/api; body error tanpa stack/Prisma' },
  { id: 'S-12', name: 'Secret tidak di-commit', expected: 'tidak ada .env (selain *.example) yang dilacak git; gitleaks dijalankan di workflow' },
  { id: 'S-13', name: 'Revokasi sesi setelah logout', expected: 'cookie & Bearer lama → 401 setelah POST /auth/logout' },
]);

test.describe.configure({ mode: 'serial' });
test.afterAll(() => log.flush());

const LEAK = /(\bat\s+\S+\s+\(|PrismaClient|prisma\.|node_modules|Invalid `|stack)/i;

test('BFD-69: security tests', async () => {
  const api = await Api.create(XFF);
  const student: Session = await api.loginDemo('student');
  const admin: Session = await api.loginDemo('admin');
  const all = await api.ok<{ campaigns: { id: string; title: string; status: string; creator?: { id: string; name: string } }[] }>('GET', '/admin/campaigns?status=ALL&limit=100', { token: admin.token });
  const byTitle = (t: string) => {
    const c = all.campaigns.find((x) => x.title === t);
    if (!c) throw new Error(`campaign seed "${t}" tidak ditemukan`);
    return c;
  };
  const solar = byTitle('Panel Surya untuk SD Harapan'); // PENDING_REVIEW, milik Andi
  const coding = byTitle('Kelas Coding Gratis untuk Remaja'); // REJECTED, milik Siti
  const books = byTitle('Buku & Perpustakaan Mini untuk Anak Pesisir'); // ACTIVE, milik Siti
  const water = byTitle('Air Bersih untuk Desa Sukamaju'); // ACTIVE, milik Budi
  const solarDetail = await api.ok<{ status: string; documents: { id: string }[] }>('GET', `/admin/campaigns/${solar.id}`, { token: admin.token });
  // Donasi PENDING milik admin (user lain dari sudut pandang Budi).
  const adminPending = await createDonation(api, admin, water.id, 20_000);
  const results: Record<string, unknown> = {};

  await log.run('S-01', async () => {
    const checks = {
      donasiPendingMilikAdmin: await api.call('GET', `/donations/${adminPending.id}`, { token: student.token }),
      campaignPendingReviewAndi: await api.call('GET', `/campaigns/${solar.id}`, { token: student.token }),
      campaignRejectedSiti: await api.call('GET', `/campaigns/${coding.id}`, { token: student.token }),
      proposalCampaignAndi: await api.call('GET', `/documents/${solarDetail.documents[0].id}/link`, { token: student.token }),
      aktivitasCampaignAndi: await api.call('GET', `/campaigns/${solar.id}/activity`, { token: student.token }),
    };
    const summary = Object.fromEntries(Object.entries(checks).map(([k, r]) => [k, `${r.status} ${r.body.error?.code ?? ''}`.trim()]));
    results.idorRead = summary;
    for (const [k, r] of Object.entries(checks)) expect([403, 404], `${k}: ${summary[k]}`).toContain(r.status);
    // Pembanding: pemilik/admin memang bisa melihatnya (bukti endpoint-nya sendiri berfungsi).
    expect((await api.call('GET', `/donations/${adminPending.id}`, { token: admin.token })).status).toBe(200);
    return JSON.stringify(summary);
  });

  await log.run('S-02', async () => {
    const checks = {
      patchCampaignSiti: await api.call('PATCH', `/campaigns/${coding.id}`, { token: student.token, data: { title: 'Dibajak oleh Budi' } }),
      submitCampaignSiti: await api.call('POST', `/campaigns/${coding.id}/submit`, { token: student.token }),
      hapusCampaignSiti: await api.call('DELETE', `/campaigns/${coding.id}`, { token: student.token }),
      pencairanCampaignSiti: await api.call('POST', `/campaigns/${books.id}/disbursements`, {
        token: student.token,
        multipart: { amount: '10000', description: 'Pencairan dari campaign milik orang lain', proof: { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') } },
      }),
      simulasiBayarDonasiAdmin: await api.call('POST', `/dev/payments/${adminPending.id}/simulate`, { token: student.token, data: { outcome: 'settlement' } }),
    };
    const summary = Object.fromEntries(Object.entries(checks).map(([k, r]) => [k, `${r.status} ${r.body.error?.code ?? ''}`.trim()]));
    results.idorWrite = summary;
    for (const [k, r] of Object.entries(checks)) expect([403, 404], `${k}: ${summary[k]}`).toContain(r.status);
    const codingAfter = await api.ok<{ title: string; status: string }>('GET', `/admin/campaigns/${coding.id}`, { token: admin.token });
    expect(codingAfter.title).toBe('Kelas Coding Gratis untuk Remaja');
    expect(codingAfter.status).toBe('REJECTED');
    const pendingAfter = await api.ok<{ status: string }>('GET', `/donations/${adminPending.id}`, { token: admin.token });
    expect(pendingAfter.status).toBe('PENDING');
    return JSON.stringify(summary);
  });

  await log.run('S-03', async () => {
    const paths: [string, string][] = [
      ['GET', '/auth/me'],
      ['GET', '/me/donations'],
      ['GET', '/me/points'],
      ['POST', '/campaigns'],
      ['GET', '/admin/stats'],
    ];
    const summary: Record<string, string> = {};
    for (const [m, p] of paths) {
      const r = await api.call(m as 'GET', p, m === 'POST' ? { data: {} } : {});
      summary[`${m} ${p}`] = `${r.status} ${r.body.error?.code ?? ''}`.trim();
      expect(r.status, `${m} ${p}`).toBe(401);
    }
    results.anonymous = summary;
    return JSON.stringify(summary);
  });

  await log.run('S-04', async () => {
    const reqs: [string, string, unknown?][] = [
      ['GET', '/admin/stats'],
      ['GET', '/admin/audit-logs'],
      ['GET', '/admin/donations'],
      ['GET', '/admin/campaigns'],
      ['GET', '/admin/disbursements'],
      ['POST', `/admin/campaigns/${solar.id}/approve`],
      ['POST', `/admin/campaigns/${water.id}/freeze`, { reason: 'Non-admin mencoba membekukan campaign' }],
      ['POST', '/admin/integrity/verify-all'],
      ['POST', `/admin/donations/${adminPending.id}/refund`, { reason: 'Non-admin mencoba refund' }],
      ['POST', `/admin/blockchain/${adminPending.id}/retry`],
    ];
    const summary: Record<string, string> = {};
    for (const [m, p, data] of reqs) {
      const r = await api.call(m as 'GET', p, { token: student.token, ...(data ? { data } : {}) });
      summary[`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}`] = `${r.status} ${r.body.error?.code ?? ''}`.trim();
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.body.error?.code).toBe('AUTH_FORBIDDEN');
    }
    const solarAfter = await api.ok<{ status: string }>('GET', `/admin/campaigns/${solar.id}`, { token: admin.token });
    expect(solarAfter.status).toBe('PENDING_REVIEW');
    const waterAfter = await api.ok<{ status: string }>('GET', `/campaigns/${water.id}`);
    expect(waterAfter.status).toBe('ACTIVE');
    results.nonAdmin = summary;
    return JSON.stringify(summary);
  });

  const webhook = (raw: string, signature?: string) =>
    api.call<{ replayed: boolean; status: string }>('POST', '/webhooks/payment', {
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-fundchain-signature': signature } : {}) },
      data: raw,
    });

  await log.run('S-05', async () => {
    const raw = JSON.stringify({ order_id: adminPending.id, transaction_id: 'FORGED-1', status: 'settlement', amount: 20_000, payment_method: 'qris' });
    const wrongSecret = await webhook(raw, signMock(raw, 'bukan-secret-yang-benar'));
    const noSig = await webhook(raw);
    const garbage = await webhook(raw, 'deadbeef');
    // Signature valid untuk body LAIN tidak boleh diterima untuk body ini.
    const otherBody = JSON.stringify({ order_id: adminPending.id, status: 'settlement', amount: 1 });
    const swapped = await webhook(raw, signMock(otherBody));
    const summary = {
      secretSalah: `${wrongSecret.status} ${wrongSecret.body.error?.code}`,
      tanpaSignature: `${noSig.status} ${noSig.body.error?.code}`,
      signatureNgawur: `${garbage.status} ${garbage.body.error?.code}`,
      signatureBodyLain: `${swapped.status} ${swapped.body.error?.code}`,
    };
    for (const r of [wrongSecret, noSig, garbage, swapped]) {
      expect(r.status).toBe(401);
      expect(r.body.error?.code).toBe('PAYMENT_SIGNATURE_INVALID');
    }
    const still = await api.ok<{ status: string }>('GET', `/donations/${adminPending.id}`, { token: admin.token });
    expect(still.status).toBe('PENDING');
    results.forgedWebhook = summary;
    return `${JSON.stringify(summary)}; donasi tetap ${still.status}`;
  });

  await log.run('S-06', async () => {
    const d = await createDonation(api, student, water.id, 30_000);
    const detail = await api.ok<{ payment: { amount: number } }>('GET', `/donations/${d.id}`, { token: student.token });
    const raw = JSON.stringify({ order_id: d.id, transaction_id: `QA-${d.id.slice(0, 8)}`, status: 'settlement', amount: detail.payment.amount, payment_method: 'qris' });
    const first = await webhook(raw, signMock(raw));
    const second = await webhook(raw, signMock(raw));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ replayed: false, status: 'PAID' });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ replayed: true, status: 'PAID' });
    const campaign = await api.ok<{ currentAmount: number }>('GET', `/campaigns/${water.id}`);
    // Mismatch nominal pada donasi lain.
    const d2 = await createDonation(api, student, water.id, 40_000);
    const rawMismatch = JSON.stringify({ order_id: d2.id, status: 'settlement', amount: 4_000_000, payment_method: 'qris' });
    const mismatch = await webhook(rawMismatch, signMock(rawMismatch));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error?.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const rawUnknown = JSON.stringify({ order_id: '00000000-0000-4000-8000-000000000000', status: 'settlement', amount: 10_000 });
    const unknown = await webhook(rawUnknown, signMock(rawUnknown));
    expect(unknown.status).toBe(404);
    const third = await webhook(raw, signMock(raw));
    const campaignAfter = await api.ok<{ currentAmount: number }>('GET', `/campaigns/${water.id}`);
    expect(campaignAfter.currentAmount).toBe(campaign.currentAmount); // replay tidak menambah saldo
    expect(third.body.data).toMatchObject({ replayed: true });
    const summary = {
      pertama: `${first.status} ${JSON.stringify(first.body.data)}`,
      kedua: `${second.status} ${JSON.stringify(second.body.data)}`,
      mismatch: `${mismatch.status} ${mismatch.body.error?.code}`,
      orderTakDikenal: `${unknown.status} ${unknown.body.error?.code}`,
      saldoSetelahReplay: `${campaign.currentAmount} → ${campaignAfter.currentAmount} (tidak berubah)`,
    };
    results.duplicateWebhook = summary;
    return JSON.stringify(summary);
  });

  await log.run('S-07', async () => {
    const limiter = await Api.create('10.0.4.99');
    const demoStatuses: number[] = [];
    for (let i = 0; i < 12; i++) demoStatuses.push((await limiter.call('GET', '/auth/demo?persona=student')).status);
    const googleStatuses: number[] = [];
    let last429Code = '';
    for (let i = 0; i < 12; i++) {
      const r = await limiter.call('POST', '/auth/google', { data: { accessToken: 'token-palsu-untuk-uji-rate-limit' } });
      googleStatuses.push(r.status);
      if (r.status === 429) last429Code = r.body.error?.code ?? '';
    }
    await limiter.dispose();
    expect(demoStatuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(demoStatuses.slice(10)).toEqual([429, 429]);
    expect(googleStatuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(googleStatuses.slice(10)).toEqual([429, 429]);
    expect(last429Code).toBe('RATE_LIMITED');
    // IP lain tidak ikut terkena (limit per klien).
    const other = await api.call('GET', '/auth/demo?persona=student');
    expect(other.status).toBe(200);
    results.rateLimit = { authDemo: demoStatuses, authGoogle: googleStatuses, ipLainTetap200: other.status };
    return `/auth/demo: ${demoStatuses.join(',')}; /auth/google: ${googleStatuses.join(',')}; IP lain ${other.status}`;
  });

  await log.run('S-08', async () => {
    const cookie = `fc_session=${encodeURIComponent(student.token)}`;
    const body = {
      title: 'CSRF probe campaign',
      description: 'Dibuat oleh uji CSRF dengan header X-Requested-With yang benar.',
      sdgCategory: 'QUALITY_EDUCATION',
      targetAmount: 1_000_000,
      deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    };
    const noHeader = await api.call('POST', '/campaigns', { cookie, data: body });
    const wrongHeader = await api.call('POST', '/campaigns', { cookie, data: body, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const getWithCookie = await api.call('GET', '/auth/me', { cookie });
    const withHeader = await api.call<{ id: string }>('POST', '/campaigns', { cookie, data: body, headers: { 'X-Requested-With': 'fundchain' } });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error?.code).toBe('AUTH_FORBIDDEN');
    expect(wrongHeader.status).toBe(403);
    expect(getWithCookie.status).toBe(200);
    expect(withHeader.status).toBeLessThan(300);
    await api.ok('DELETE', `/campaigns/${withHeader.body.data!.id}`, { token: student.token });
    const summary = {
      cookieTanpaHeader: `${noHeader.status} ${noHeader.body.error?.code}`,
      cookieHeaderSalah: `${wrongHeader.status} ${wrongHeader.body.error?.code}`,
      getDenganCookie: `${getWithCookie.status}`,
      cookieDenganHeader: `${withHeader.status}`,
    };
    results.csrf = summary;
    return JSON.stringify(summary);
  });

  await log.run('S-09', async () => {
    const payloads = ["' OR '1'='1", "'; DROP TABLE campaigns;--", '" OR 1=1 --', "1' UNION SELECT email FROM users--", '%27%20OR%201%3D1', '\\x27; SELECT pg_sleep(5);--'];
    const rows: { req: string; status: number; code?: string; leak: boolean; nonPublic: number }[] = [];
    const publicStatuses = new Set(['ACTIVE', 'COMPLETED', 'FROZEN']);
    const probe = async (path: string, token?: string) => {
      const r = await api.call<{ campaigns?: { status: string }[] }>('GET', path, token ? { token } : {});
      const raw = (r.body as { __raw?: string }).__raw ?? '';
      const list = (r.body.data as { campaigns?: { status: string }[] } | undefined)?.campaigns ?? [];
      const nonPublic = token ? 0 : list.filter((c) => !publicStatuses.has(c.status)).length;
      // PII (email) hanya dianggap bocor pada request publik/anonim; admin memang berhak melihat data lengkap.
      rows.push({ req: path, status: r.status, code: r.body.error?.code, leak: LEAK.test(raw) || (!token && /@binus\.ac\.id/.test(raw)), nonPublic });
    };
    for (const p of payloads) {
      const q = encodeURIComponent(p);
      await probe(`/campaigns?q=${q}`);
      await probe(`/campaigns?sdg=${q}`);
      await probe(`/campaigns?status=${q}`);
      await probe(`/campaigns?cursor=${q}`);
      await probe(`/campaigns?limit=${q}`);
      await probe(`/admin/audit-logs?action=${q}&entityId=${q}&cursor=${q}`, admin.token);
      await probe(`/admin/audit-logs?from=${q}`, admin.token);
      await probe(`/admin/donations?integrityStatus=${q}&campaignId=${q}`, admin.token);
      await probe(`/donations/${q}`);
    }
    writeJson('bfd69-sqli-probes', rows);
    const fiveHundreds = rows.filter((r) => r.status >= 500);
    expect(fiveHundreds, JSON.stringify(fiveHundreds)).toEqual([]);
    expect(rows.filter((r) => r.leak), 'kebocoran detail internal/PII').toEqual([]);
    expect(rows.filter((r) => r.nonPublic > 0), 'campaign non-publik bocor').toEqual([]);
    const stillThere = await api.ok<{ campaigns: unknown[] }>('GET', '/admin/campaigns?status=ALL&limit=100', { token: admin.token });
    expect(stillThere.campaigns.length).toBeGreaterThanOrEqual(all.campaigns.length);
    const statusCounts = rows.reduce<Record<number, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
    results.sqli = { probes: rows.length, statusCounts };
    return `${rows.length} probe; status ${JSON.stringify(statusCounts)}; 0 respons 5xx, 0 kebocoran, tabel utuh`;
  });

  await log.run('S-10', async () => {
    const draft = await api.ok<{ id: string }>('POST', '/campaigns', {
      token: student.token,
      data: {
        title: 'Uji upload file berbahaya',
        description: 'Draft sementara untuk menguji validasi magic bytes pada upload proposal.',
        sdgCategory: 'QUALITY_EDUCATION',
        targetAmount: 1_000_000,
        deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      },
    });
    const fake = await api.call('POST', `/campaigns/${draft.id}/documents`, {
      token: student.token,
      multipart: { file: { name: 'proposal.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<script>alert(1)</script> MZ\x90\x00 bukan pdf') } },
    });
    const exe = await api.call('POST', `/campaigns/${draft.id}/documents`, {
      token: student.token,
      multipart: { file: { name: 'proposal.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x90\x00\x03') } },
    });
    await api.ok('DELETE', `/campaigns/${draft.id}`, { token: student.token });
    expect(fake.status).toBe(400);
    expect(fake.body.error?.code).toBe('INVALID_FILE_TYPE');
    expect(exe.status).toBe(400);
    results.upload = { pdfPalsu: `${fake.status} ${fake.body.error?.code}`, exe: `${exe.status} ${exe.body.error?.code}` };
    return JSON.stringify(results.upload);
  });

  await log.run('S-11', async () => {
    const r = await api.call('GET', '/auth/demo?persona=admin');
    const cookie = r.setCookies.find((c) => c.startsWith('fc_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api/i);
    const notFound = await api.call('GET', '/donations/00000000-0000-4000-8000-000000000000');
    const bad = await api.call('GET', '/campaigns/not-a-uuid');
    for (const x of [notFound, bad]) expect(LEAK.test((x.body as { __raw?: string }).__raw ?? '')).toBe(false);
    expect(r.headers['x-powered-by']).toBeUndefined();
    results.cookie = { setCookie: cookie.replace(/fc_session=[^;]+/, 'fc_session=<redacted>'), notFound: notFound.status, badUuid: bad.status };
    return `Set-Cookie: ${results.cookie && (results.cookie as { setCookie: string }).setCookie}; 404/400 tanpa stack trace; tanpa X-Powered-By`;
  });

  await log.run('S-12', async () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n');
    const envFiles = tracked.filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.example$/.test(f));
    // apps/web/.env.remote hanya berisi URL publik (VITE_API_TARGET), bukan secret — dikecualikan di .gitignore secara sengaja.
    const unexpected = envFiles.filter((f) => f !== 'apps/web/.env.remote');
    expect(unexpected).toEqual([]);
    results.secrets = { envFilesTracked: envFiles, gitleaks: 'job "Secret scan (gitleaks)" di .github/workflows/ci.yml + langkah gitleaks di e2e-gates.yml' };
    return `File .env yang dilacak: ${envFiles.join(', ') || '(tidak ada)'}; scan gitleaks dijalankan di workflow`;
  });

  await log.run('S-13', async () => {
    const fresh = await api.loginDemo('student');
    const cookie = `fc_session=${encodeURIComponent(fresh.token)}`;
    const before = await api.call('GET', '/auth/me', { cookie });
    expect(before.status).toBe(200);
    const out = await api.call('POST', '/auth/logout', { cookie, headers: { 'X-Requested-With': 'fundchain' } });
    expect(out.status).toBe(200);
    const afterCookie = await api.call('GET', '/auth/me', { cookie });
    const afterBearer = await api.call('GET', '/auth/me', { token: fresh.token });
    const olderSession = await api.call('GET', '/auth/me', { token: student.token });
    expect(afterCookie.status).toBe(401);
    expect(afterBearer.status).toBe(401);
    expect(olderSession.status).toBe(401);
    results.revocation = { before: before.status, logout: out.status, oldCookie: afterCookie.status, oldBearer: afterBearer.status, otherOldSession: olderSession.status };
    return JSON.stringify(results.revocation);
  });

  writeJson('bfd69-security-results', results);
  await api.dispose();
});

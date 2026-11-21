import { createHmac, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { type APIRequestContext, type APIResponse, type Browser, type BrowserContext, request } from '@playwright/test';
import { API_URL, MOCK_WEBHOOK_SECRET, SAMPLE_MILESTONE, SAMPLE_PROPOSAL, WEB_URL } from './env';

export type Persona = 'student' | 'admin';

export interface Envelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export interface Session {
  persona: Persona;
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

export interface CallResult<T = unknown> {
  status: number;
  body: Envelope<T>;
  headers: Record<string, string>;
  setCookies: string[];
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface CallOptions {
  /** Bearer token sesi. */
  token?: string;
  /** Header `Cookie` mentah (untuk uji cookie/CSRF). */
  cookie?: string;
  headers?: Record<string, string>;
  data?: unknown;
  multipart?: Record<string, string | number | { name: string; mimeType: string; buffer: Buffer }>;
}

/**
 * Klien API langsung ke `E2E_API_URL` (loopback). Setiap instance punya X-Forwarded-For sendiri:
 * API mempercayai proxy loopback di non-production, sehingga throttle per-IP terpisah per spec.
 * Tidak menyimpan cookie (`storageState` kosong); autentikasi selalu eksplisit lewat opsi.
 */
export class Api {
  private constructor(
    readonly ctx: APIRequestContext,
    readonly xff: string,
  ) {}

  static async create(xff: string) {
    const ctx = await request.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': xff } });
    return new Api(ctx, xff);
  }

  async dispose() {
    await this.ctx.dispose();
  }

  async call<T = unknown>(method: Method, path: string, opts: CallOptions = {}): Promise<CallResult<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.Cookie = opts.cookie;
    const url = `${API_URL}${path}`;
    let res: APIResponse | undefined;
    const base = { headers, failOnStatusCode: false, maxRedirects: 0 } as const;
    // Konteks request baru per panggilan: cookie jar Playwright TIDAK boleh membawa cookie sesi dari
    // login sebelumnya (guard memprioritaskan cookie di atas Bearer, sehingga identitas bisa tertukar).
    const ctx = await request.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': this.xff } });
    let text = '';
    let status = 0;
    let resHeaders: Record<string, string> = {};
    let setCookies: string[] = [];
    try {
      if (opts.multipart) res = await ctx.fetch(url, { ...base, method, multipart: opts.multipart });
      else if (opts.data !== undefined) res = await ctx.fetch(url, { ...base, method, data: opts.data });
      else res = await ctx.fetch(url, { ...base, method });
      text = await res.text();
      status = res.status();
      resHeaders = res.headers();
      setCookies = res
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
        .map((h) => h.value);
    } finally {
      await ctx.dispose();
    }
    let body: Envelope<T>;
    try {
      body = JSON.parse(text) as Envelope<T>;
    } catch {
      body = { success: false, error: { code: 'NON_JSON', message: text.slice(0, 500) } };
    }
    // Ikat raw text untuk pemeriksaan kebocoran (stack trace dsb.).
    (body as Envelope<T> & { __raw?: string }).__raw = text;
    return { status, body, headers: resHeaders, setCookies };
  }

  /** Panggilan yang wajib sukses (2xx + success:true); melempar error berisi body bila tidak. */
  async ok<T = unknown>(method: Method, path: string, opts: CallOptions = {}): Promise<T> {
    const r = await this.call<T>(method, path, opts);
    if (r.status >= 300 || !r.body.success) {
      throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body.error ?? r.body).slice(0, 500)}`);
    }
    return r.body.data as T;
  }

  /** BFD-12: login demo. Token diambil dari cookie httpOnly `fc_session` yang dipasang API. */
  async loginDemo(persona: Persona): Promise<Session> {
    const r = await this.call<{ user: Session['user'] }>('GET', `/auth/demo?persona=${persona}`);
    if (r.status !== 200) throw new Error(`login demo ${persona} gagal: ${r.status} ${JSON.stringify(r.body.error)}`);
    const token = sessionTokenFromSetCookie(r.setCookies);
    if (!token) throw new Error('Cookie fc_session tidak dipasang oleh /auth/demo');
    return { persona, token, user: r.body.data!.user };
  }
}

export function sessionTokenFromSetCookie(setCookies: string[]): string | null {
  for (const c of setCookies) {
    const m = /^fc_session=([^;]*)/.exec(c);
    if (m && m[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

/**
 * Konteks browser yang sudah login sebagai `session` (cookie httpOnly + penanda "pernah login"
 * di localStorage yang dipakai web untuk memanggil /auth/me). Dipakai untuk persona kedua tanpa
 * logout UI (logout mencabut SEMUA sesi user itu, BFD-11).
 */
export async function browserContextFor(browser: Browser, session: Session | null, xff: string, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...extra, extraHTTPHeaders: { 'X-Forwarded-For': xff } });
  if (session) {
    const host = new URL(WEB_URL).hostname;
    await ctx.addCookies([{ name: 'fc_session', value: session.token, domain: host, path: '/api', httpOnly: true, sameSite: 'Lax', secure: false }]);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('fundchain-session', JSON.stringify({ state: { signedIn: true }, version: 0 }));
      } catch {
        /* abaikan */
      }
    });
  }
  return ctx;
}

const DAY = 86_400_000;

export interface CampaignLite {
  id: string;
  title: string;
  status: string;
  creatorId?: string;
  currentAmount?: number;
}

/** Buat campaign → unggah proposal → ajukan → admin approve. Hasil: campaign ACTIVE milik `student`. */
export async function createActiveCampaign(api: Api, student: Session, admin: Session, title: string, targetAmount = 5_000_000) {
  const c = await api.ok<CampaignLite>('POST', '/campaigns', {
    token: student.token,
    data: {
      title,
      description: `${title}: campaign uji otomatis QA (E2E harness) untuk membuktikan alur end-to-end FundChain.`,
      sdgCategory: 'QUALITY_EDUCATION',
      targetAmount,
      deadline: new Date(Date.now() + 30 * DAY).toISOString(),
    },
  });
  await api.ok('POST', `/campaigns/${c.id}/documents`, {
    token: student.token,
    multipart: { file: { name: 'proposal-contoh.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(SAMPLE_PROPOSAL) } },
  });
  await api.ok('POST', `/campaigns/${c.id}/submit`, { token: student.token });
  await api.ok('POST', `/admin/campaigns/${c.id}/approve`, { token: admin.token });
  return api.ok<CampaignLite>('GET', `/campaigns/${c.id}`, { token: student.token });
}

export interface DonationDetail {
  id: string;
  amount: number;
  status: string;
  hash: string | null;
  canonicalPayload: string | null;
  integrityStatus: string;
  campaign: { id: string; title: string };
  payment: { status: string; amount: number } | null;
  blockchain: { status: string; txHash: string | null; blockNumber: number | null; chainId: number; network: string; explorerUrl: string | null } | null;
}

/** Buat donasi (Idempotency-Key acak) tanpa membayar. */
export async function createDonation(api: Api, donor: Session, campaignId: string, amount: number) {
  return api.ok<DonationDetail>('POST', `/campaigns/${campaignId}/donations`, {
    token: donor.token,
    headers: { 'Idempotency-Key': randomUUID() },
    data: { amount, anonymous: false },
  });
}

/** Donasi + simulasi settlement (webhook mock bertanda tangan lewat /dev/payments/:id/simulate). */
export async function donateAndPay(api: Api, donor: Session, campaignId: string, amount: number) {
  const d = await createDonation(api, donor, campaignId, amount);
  const r = await api.ok<{ status: string }>('POST', `/dev/payments/${d.id}/simulate`, { token: donor.token, data: { outcome: 'settlement' } });
  if (r.status !== 'PAID') throw new Error(`simulate tidak PAID: ${JSON.stringify(r)}`);
  return d.id;
}

/** Tunggu worker menotarisasi donasi di Hardhat (status CONFIRMED). */
export async function waitNotarized(api: Api, token: string, donationId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last: DonationDetail | undefined;
  while (Date.now() < deadline) {
    last = await api.ok<DonationDetail>('GET', `/donations/${donationId}`, { token });
    if (last.blockchain?.status === 'CONFIRMED') return last;
    if (last.blockchain?.status === 'FAILED') throw new Error(`Notarisasi FAILED untuk ${donationId}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Notarisasi ${donationId} belum CONFIRMED setelah ${timeoutMs / 1000}s (status ${last?.blockchain?.status})`);
}

/** Poll sampai `predicate` true. */
export async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs: number, intervalMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!predicate(last)) {
    if (Date.now() > deadline) throw new Error(`pollUntil timeout setelah ${timeoutMs / 1000}s; nilai terakhir: ${JSON.stringify(last).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

/** Ajukan pencairan (multipart, bukti PDF contoh). */
export async function requestDisbursement(api: Api, student: Session, campaignId: string, amount: number, description: string) {
  return api.call<{ id: string; status: string }>('POST', `/campaigns/${campaignId}/disbursements`, {
    token: student.token,
    multipart: {
      amount: String(amount),
      description,
      proof: { name: 'bukti-milestone-contoh.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(SAMPLE_MILESTONE) },
    },
  });
}

/** Tanda tangan webhook mock: HMAC-SHA256 atas raw body yang PERSIS dikirim. */
export function signMock(rawBody: string, secret = MOCK_WEBHOOK_SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

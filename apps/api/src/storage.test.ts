import { LIMITS } from '@fundchain/shared';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './common/app-error';
import type { CurrentUserPayload } from './common/auth';
import { AuditService } from './modules/audit/audit.service';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { DisbursementsService } from './modules/disbursements/disbursements.service';
import { FilesController } from './modules/storage/files.controller';
import { resolveStorageConfig } from './modules/storage/storage.config';
import { StorageService } from './modules/storage/storage.service';

// BFD-42 / BFD-15. Tidak ada koneksi DB maupun Supabase sungguhan: Prisma palsu + fetch di-stub.

const SUPA = 'https://proj.supabase.co';
const KEY = 'service-role-test';
const owner = { id: 'user-owner', role: 'STUDENT' } as unknown as CurrentUserPayload;
const stranger = { id: 'user-other', role: 'STUDENT' } as unknown as CurrentUserPayload;
const admin = { id: 'user-admin', role: 'ADMIN' } as unknown as CurrentUserPayload;
const code = (c: string, status?: number) =>
  expect.objectContaining(status === undefined ? { code: c } : { code: c, status });

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

type Row = Record<string, any>;

/** Prisma palsu dengan tabel stored_files di memori. */
function fakePrisma(extra: Record<string, unknown> = {}) {
  const files = new Map<string, Row>();
  let seq = 0;
  const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => r[k] === v);
  const storedFile = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        storageDriver: 'db',
        status: 'CONFIRMED',
        purpose: null,
        ownerId: null,
        originalName: null,
        createdAt: new Date(),
        ...data,
      };
      files.set(row.key, row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => [...files.values()].find((r) => match(r, where)) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hits = [...files.values()].filter((r) => match(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    }),
    delete: vi.fn(async ({ where }: { where: { key: string } }) => {
      const row = files.get(where.key);
      files.delete(where.key);
      return row;
    }),
  };
  const auditLog = { create: vi.fn(async ({ data }: { data: unknown }) => data) };
  const db: Record<string, any> = { storedFile, auditLog, ...extra };
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[]),
  );
  return { db: db as any, files, storedFile };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch palsu ala Supabase Storage. `objects` = isi objek yang "sudah di-PUT browser". */
function stubSupabase(objects: Record<string, { body: Buffer; contentType: string }> = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, headers, body: init.body });
    const base = `${SUPA}/storage/v1`;
    let m: RegExpMatchArray | null;
    if (method === 'POST' && (m = url.match(/\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
      return Response.json({ url: `/object/upload/sign/${m[1]}/${m[2]}?token=up-token` });
    }
    if (method === 'POST' && (m = url.match(/\/object\/sign\/([^/]+)\/(.+)$/))) {
      return Response.json({ signedURL: `/object/sign/${m[1]}/${m[2]}?token=dl-token` });
    }
    if (method === 'GET' && (m = url.match(/\/object\/authenticated\/[^/]+\/(.+)$/))) {
      const obj = objects[decodeURIComponent(m[1])];
      if (!obj) return new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
      const range = headers.Range?.match(/bytes=(\d+)-(\d+)/);
      if (range) {
        const end = Math.min(Number(range[2]), obj.body.length - 1);
        return new Response(new Uint8Array(obj.body.subarray(0, end + 1)), {
          status: 206,
          headers: { 'content-type': obj.contentType, 'content-range': `bytes 0-${end}/${obj.body.length}` },
        });
      }
      return new Response(new Uint8Array(obj.body), { status: 200, headers: { 'content-type': obj.contentType } });
    }
    if (method === 'DELETE' && url === `${base}/object/fundchain-files`) return Response.json([]);
    if (method === 'POST' && url.startsWith(`${base}/object/`)) return Response.json({ Key: 'ok' });
    return new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function useSupabaseEnv() {
  vi.stubEnv('STORAGE_DRIVER', 'supabase');
  vi.stubEnv('SUPABASE_URL', SUPA);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
  vi.stubEnv('SUPABASE_STORAGE_BUCKET', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resolveStorageConfig — pemilihan driver', () => {
  it('default db bila STORAGE_DRIVER kosong', () => {
    expect(resolveStorageConfig({})).toMatchObject({ driver: 'db', error: null, supabase: null });
  });

  it('supabase lengkap → driver supabase, bucket default fundchain-files', () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: `${SUPA}/`, SUPABASE_SERVICE_ROLE_KEY: KEY });
    expect(cfg).toMatchObject({ driver: 'supabase', error: null, supabase: { url: SUPA, serviceRoleKey: KEY, bucket: 'fundchain-files' } });
  });

  it('supabase tanpa env → fallback db + pesan error yang menyebut env yang kurang', () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: SUPA });
    expect(cfg.driver).toBe('db');
    expect(cfg.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('nilai tidak dikenal → fallback db dengan error', () => {
    expect(resolveStorageConfig({ STORAGE_DRIVER: 's3' })).toMatchObject({ driver: 'db', error: expect.stringContaining('s3') });
  });

  it('onModuleInit mencatat error saat env kurang; /files/config melaporkan driver efektif', () => {
    vi.stubEnv('STORAGE_DRIVER', 'supabase');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const storage = new StorageService(fakePrisma().db);
    const spy = vi.spyOn((storage as any).logger, 'error').mockImplementation(() => undefined);
    storage.onModuleInit();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_URL'));
    expect(storage.publicConfig()).toEqual({ driver: 'db', maxBytes: LIMITS.FILE_MAX_BYTES, directUpload: false });
  });

  it('/files/config driver supabase → maxBytes 10MB', () => {
    useSupabaseEnv();
    const storage = new StorageService(fakePrisma().db);
    expect(storage.publicConfig()).toEqual({ driver: 'supabase', maxBytes: LIMITS.FILE_MAX_BYTES_DIRECT, directUpload: true });
  });
});

describe('POST /files/upload-url', () => {
  const input = { purpose: 'campaign-document', fileName: 'proposal.pdf', contentType: 'application/pdf', size: 5_000_000 };

  it('driver db → STORAGE_DIRECT_UPLOAD_DISABLED, tanpa panggilan jaringan', async () => {
    const { fetchMock } = stubSupabase();
    const storage = new StorageService(fakePrisma().db);
    await expect(storage.createUploadUrl(owner.id, input)).rejects.toThrowError(code('STORAGE_DIRECT_UPLOAD_DISABLED', 409));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('driver supabase', () => {
    beforeEach(useSupabaseEnv);

    it('menolak > 10MB → FILE_TOO_LARGE', async () => {
      stubSupabase();
      const { db, storedFile } = fakePrisma();
      const storage = new StorageService(db);
      await expect(storage.createUploadUrl(owner.id, { ...input, size: LIMITS.FILE_MAX_BYTES_DIRECT + 1 })).rejects.toThrowError(
        code('FILE_TOO_LARGE', 400),
      );
      expect(storedFile.create).not.toHaveBeenCalled();
    });

    it.each([
      ['ekstensi salah', { fileName: 'proposal.exe' }],
      ['mime salah', { contentType: 'text/html' }],
      ['PNG untuk proposal (hanya PDF)', { fileName: 'scan.png', contentType: 'image/png' }],
    ])('menolak %s → INVALID_FILE_TYPE', async (_label, patch) => {
      const { fetchMock } = stubSupabase();
      const storage = new StorageService(fakePrisma().db);
      await expect(storage.createUploadUrl(owner.id, { ...input, ...patch })).rejects.toThrowError(code('INVALID_FILE_TYPE', 400));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('menolak purpose tidak dikenal / ukuran tidak valid → VALIDATION_ERROR', async () => {
      stubSupabase();
      const storage = new StorageService(fakePrisma().db);
      await expect(storage.createUploadUrl(owner.id, { ...input, purpose: 'avatar' })).rejects.toThrowError(code('VALIDATION_ERROR'));
      await expect(storage.createUploadUrl(owner.id, { ...input, size: 0 })).rejects.toThrowError(code('VALIDATION_ERROR'));
    });

    it('meminta signed upload URL ke Supabase (bentuk request) & membuat baris PENDING', async () => {
      const { calls } = stubSupabase();
      const { db, files } = fakePrisma();
      const storage = new StorageService(db);
      const out = await storage.createUploadUrl(owner.id, { ...input, purpose: 'disbursement-proof', fileName: 'nota.JPG', contentType: 'image/jpeg' });

      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call.method).toBe('POST');
      expect(call.url).toMatch(new RegExp(`^${SUPA}/storage/v1/object/upload/sign/fundchain-files/disbursements/[0-9a-f-]{36}\\.jpg$`));
      expect(call.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, apikey: KEY });
      expect(call.headers['x-upsert']).toBeUndefined();

      const row = [...files.values()][0];
      expect(row).toMatchObject({
        status: 'PENDING',
        storageDriver: 'supabase',
        purpose: 'disbursement-proof',
        ownerId: owner.id,
        contentType: 'image/jpeg',
        originalName: 'nota.JPG',
        data: null,
      });
      expect(out).toMatchObject({
        fileId: row.id,
        method: 'PUT',
        token: 'up-token',
        maxBytes: LIMITS.FILE_MAX_BYTES_DIRECT,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      expect(out.uploadUrl).toBe(`${SUPA}/storage/v1/object/upload/sign/fundchain-files/${row.key}?token=up-token`);
    });
  });
});

describe('attach dengan fileId — verifikasi magic bytes', () => {
  beforeEach(useSupabaseEnv);

  async function pending(purpose = 'campaign-document', fileName = 'proposal.pdf', contentType = 'application/pdf') {
    stubSupabase();
    const prisma = fakePrisma();
    const storage = new StorageService(prisma.db);
    const out = await storage.createUploadUrl(owner.id, { purpose, fileName, contentType, size: 1000 });
    const row = prisma.files.get([...prisma.files.keys()][0])!;
    return { ...prisma, storage, fileId: out.fileId, row };
  }

  it('magic bytes cocok → CONFIRMED dengan ukuran asli dari Storage (Range 16 byte)', async () => {
    const p = await pending();
    const big = Buffer.concat([PDF, Buffer.alloc(7_000_000)]);
    const { calls } = stubSupabase({ [p.row.key]: { body: big, contentType: 'application/pdf' } });
    const stored = await p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document');
    expect(stored).toEqual({ key: p.row.key, originalName: 'proposal.pdf', fileType: 'application/pdf', size: big.length });
    expect(p.row).toMatchObject({ status: 'CONFIRMED', size: big.length });
    expect(calls[0]).toMatchObject({ method: 'GET', headers: expect.objectContaining({ Range: 'bytes=0-15' }) });
    expect(calls[0].url).toBe(`${SUPA}/storage/v1/object/authenticated/fundchain-files/${p.row.key}`);
  });

  it('isi bukan PDF → INVALID_FILE_TYPE, objek dihapus dari Storage & baris dihapus', async () => {
    const p = await pending();
    const { calls } = stubSupabase({ [p.row.key]: { body: PNG, contentType: 'application/pdf' } });
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document')).rejects.toThrowError(code('INVALID_FILE_TYPE', 400));
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe(`${SUPA}/storage/v1/object/fundchain-files`);
    expect(JSON.parse(String(del?.body))).toEqual({ prefixes: [p.row.key] });
    expect(p.files.size).toBe(0);
  });

  it('content-type tersimpan berbeda (mis. text/html) → INVALID_FILE_TYPE + hapus', async () => {
    const p = await pending();
    const { calls } = stubSupabase({ [p.row.key]: { body: PDF, contentType: 'text/html' } });
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document')).rejects.toThrowError(code('INVALID_FILE_TYPE'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('ukuran asli > 10MB → FILE_TOO_LARGE + hapus', async () => {
    const p = await pending();
    const huge = Buffer.concat([PDF, Buffer.alloc(LIMITS.FILE_MAX_BYTES_DIRECT)]);
    const { calls } = stubSupabase({ [p.row.key]: { body: huge, contentType: 'application/pdf' } });
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document')).rejects.toThrowError(code('FILE_TOO_LARGE'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('bukan pemilik / purpose lain / dipakai dua kali ditolak', async () => {
    const p = await pending();
    stubSupabase({ [p.row.key]: { body: PDF, contentType: 'application/pdf' } });
    await expect(p.storage.confirmDirect(p.fileId, stranger.id, 'campaign-document')).rejects.toThrowError(code('NOT_FOUND'));
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'disbursement-proof')).rejects.toThrowError(code('VALIDATION_ERROR'));
    await p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document');
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document')).rejects.toThrowError(code('FILE_NOT_PENDING', 409));
  });

  it('objek belum di-PUT → VALIDATION_ERROR, baris PENDING tetap (bisa dicoba lagi)', async () => {
    const p = await pending();
    stubSupabase({});
    await expect(p.storage.confirmDirect(p.fileId, owner.id, 'campaign-document')).rejects.toThrowError(code('VALIDATION_ERROR'));
    expect(p.row.status).toBe('PENDING');
  });

  it('CampaignsService.uploadDocument memakai fileId → dokumen tercatat dengan key Supabase', async () => {
    const p = await pending();
    stubSupabase({ [p.row.key]: { body: PDF, contentType: 'application/pdf' } });
    const campaignDocument = { create: vi.fn(async ({ data }: { data: Row }) => ({ id: 'doc-1', ...data })) };
    Object.assign(p.db, {
      campaign: { findUnique: vi.fn(async () => ({ id: 'camp-1', creatorId: owner.id, status: 'DRAFT', deletedAt: null })) },
      campaignDocument,
    });
    const campaigns = new CampaignsService(p.db, new AuditService(p.db), p.storage);
    const doc = await campaigns.uploadDocument('camp-1', undefined, owner, null, p.fileId);
    expect(doc).toMatchObject({ storageKey: p.row.key, fileType: 'application/pdf', originalName: 'proposal.pdf' });
  });

  it('DisbursementsService.create tanpa file & tanpa fileId → DISBURSEMENT_PROOF_REQUIRED', async () => {
    const { db } = fakePrisma({
      campaign: { findUnique: vi.fn(async () => ({ id: 'camp-1', creatorId: owner.id, status: 'ACTIVE', currentAmount: 1_000_000 })) },
    });
    const service = new DisbursementsService(db, new AuditService(db), new StorageService(db));
    await expect(service.create('camp-1', { amount: 1000, description: 'Pembelian buku tahap 1' }, undefined, owner, null)).rejects.toThrowError(
      code('DISBURSEMENT_PROOF_REQUIRED'),
    );
  });

  it('driver db + fileId → STORAGE_DIRECT_UPLOAD_DISABLED', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'db');
    const storage = new StorageService(fakePrisma().db);
    await expect(storage.confirmDirect('00000000-0000-4000-8000-000000000001', owner.id, 'campaign-document')).rejects.toThrowError(
      code('STORAGE_DIRECT_UPLOAD_DISABLED'),
    );
  });
});

describe('GET /files/:id — akses & signed download URL', () => {
  function setup(opts: { driver: 'db' | 'supabase'; doc?: Row | null; disbursement?: Row | null; campaignStatus?: string; ownerId?: string | null }) {
    if (opts.driver === 'supabase') useSupabaseEnv();
    const stub = stubSupabase();
    const prisma = fakePrisma({
      campaignDocument: {
        findFirst: vi.fn(async () => opts.doc ?? null),
        findUnique: vi.fn(async () => opts.doc ?? null),
      },
      disbursement: { findFirst: vi.fn(async () => opts.disbursement ?? null) },
      campaign: {
        findUnique: vi.fn(async () => ({
          id: 'camp-1',
          creatorId: owner.id,
          status: opts.campaignStatus ?? 'ACTIVE',
          deletedAt: null,
          documents: [],
          creator: { id: owner.id, name: 'Owner' },
        })),
      },
    });
    const id = '11111111-1111-4111-8111-111111111111';
    prisma.files.set('k/file.pdf', {
      id,
      key: 'k/file.pdf',
      data: opts.driver === 'db' ? new Uint8Array(PDF) : null,
      contentType: 'application/pdf',
      size: PDF.length,
      storageDriver: opts.driver,
      status: 'CONFIRMED',
      ownerId: opts.ownerId ?? null,
      originalName: 'file.pdf',
    });
    const storage = new StorageService(prisma.db);
    const campaigns = new CampaignsService(prisma.db, new AuditService(prisma.db), storage);
    // getDetail butuh banyak relasi; untuk uji akses cukup aturan visibilitasnya.
    vi.spyOn(campaigns, 'assertDocumentVisible').mockImplementation(async (_docId, user) => {
      const visible = (opts.campaignStatus ?? 'ACTIVE') === 'ACTIVE' || user?.id === owner.id || user?.role === 'ADMIN';
      if (!visible) throw new AppError('AUTH_FORBIDDEN', 'forbidden');
      return opts.doc as any;
    });
    const controller = new FilesController(prisma.db, storage, campaigns);
    const res = { setHeader: vi.fn() } as any;
    return { controller, id, res, ...stub };
  }

  const proof = { id: 'd-1', requesterId: owner.id, proofName: 'nota.pdf', proofKey: 'k/file.pdf' };
  const doc = { id: 'doc-1', campaignId: 'camp-1', originalName: 'proposal.pdf', storageKey: 'k/file.pdf' };

  it('bukti pencairan: anonim 401, orang lain 403', async () => {
    const { controller, id, res } = setup({ driver: 'supabase', disbursement: proof });
    await expect(controller.file(id, res, undefined, undefined, undefined)).rejects.toThrowError(code('AUTH_UNAUTHENTICATED', 401));
    await expect(controller.file(id, res, undefined, undefined, stranger)).rejects.toThrowError(code('AUTH_FORBIDDEN', 403));
  });

  it('bukti pencairan supabase: admin dapat signed download URL 5 menit (bentuk request benar)', async () => {
    const { controller, id, res, calls } = setup({ driver: 'supabase', disbursement: proof });
    const out = await controller.file(id, res, undefined, undefined, admin);
    expect(out).toEqual({ url: `${SUPA}/storage/v1/object/sign/fundchain-files/k/file.pdf?token=dl-token`, expiresIn: 300 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${SUPA}/storage/v1/object/sign/fundchain-files/k/file.pdf` });
    expect(JSON.parse(String(calls[0].body))).toEqual({ expiresIn: 300 });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('dokumen campaign non-publik: orang lain ditolak, pemilik dapat URL', async () => {
    const { controller, id, res } = setup({ driver: 'supabase', doc, campaignStatus: 'DRAFT' });
    await expect(controller.file(id, res, undefined, undefined, stranger)).rejects.toThrowError(code('AUTH_FORBIDDEN'));
    await expect(controller.file(id, res, undefined, undefined, owner)).resolves.toMatchObject({ url: expect.stringContaining('dl-token') });
  });

  it('file belum di-attach hanya untuk pengunggahnya', async () => {
    const { controller, id, res } = setup({ driver: 'supabase', ownerId: owner.id });
    await expect(controller.file(id, res, undefined, undefined, stranger)).rejects.toThrowError(code('NOT_FOUND'));
    await expect(controller.file(id, res, undefined, undefined, owner)).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('baris db di-stream seperti sebelumnya (tanpa panggilan Supabase)', async () => {
    const { controller, id, res, fetchMock } = setup({ driver: 'db', disbursement: proof });
    const out = await controller.file(id, res, undefined, undefined, owner);
    const chunks: Buffer[] = [];
    for await (const chunk of out.getStream() as Readable) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('link baris db → URL API bertanda tangan yang bisa dibuka tanpa header identitas', async () => {
    const { controller, id, res } = setup({ driver: 'db', disbursement: proof });
    const { url } = await controller.link(id, admin);
    expect(url).toMatch(new RegExp(`^/api/v1/files/${id}\\?e=\\d+&t=[0-9a-f]{64}$`));
    const q = new URL(url, 'http://x').searchParams;
    const out = await controller.file(id, res, q.get('e')!, q.get('t')!, undefined);
    expect(out).toHaveProperty('getStream');
  });
});

describe('driver db — jalur multipart tidak berubah', () => {
  it('save() menyimpan bytea ke stored_files tanpa memanggil jaringan', async () => {
    const { fetchMock } = stubSupabase();
    const { db, files } = fakePrisma();
    const storage = new StorageService(db);
    const file = { originalname: 'proposal.pdf', mimetype: 'application/pdf', buffer: PDF, size: PDF.length } as Express.Multer.File;
    const out = await storage.save(file, 'proposals/camp-1', ['pdf']);
    expect(files.get(out.key)).toMatchObject({ storageDriver: 'db', contentType: 'application/pdf' });
    expect(Buffer.from(files.get(out.key)!.data).equals(PDF)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('driver supabase: multipart ≤4MB diteruskan server ke Storage (tanpa bytea)', async () => {
    useSupabaseEnv();
    const { calls } = stubSupabase();
    const { db, files } = fakePrisma();
    const storage = new StorageService(db);
    const file = { originalname: 'proposal.pdf', mimetype: 'application/pdf', buffer: PDF, size: PDF.length } as Express.Multer.File;
    const out = await storage.save(file, 'proposals/camp-1', ['pdf']);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${SUPA}/storage/v1/object/fundchain-files/${out.key}` });
    expect(calls[0].headers).toMatchObject({ 'Content-Type': 'application/pdf', 'x-upsert': 'false' });
    expect(files.get(out.key)).toMatchObject({ storageDriver: 'supabase', data: null });
  });
});

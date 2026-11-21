import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Endpoint manual retry POST admin/blockchain/:donationId/retry. Semua dependency tiruan: tanpa DB / RPC.
vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/audit/audit.service', () => ({ AuditService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('./modules/blockchain/notarization.worker', () => ({ NotarizationWorker: class {} }));
vi.mock('./modules/integrity/integrity.service', () => ({ IntegrityService: class {} }));

import { ActingUserGuard } from './common/auth';
import type { PrismaService } from './common/prisma.service';
import { createSessionToken } from './common/session-token';
import { IntegrityController } from './modules/integrity/integrity.controller';

const DONATION = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const ADMIN = { id: 'u-admin', email: 'a@x.id', name: 'Admin', role: 'ADMIN' as const, integritySubjectId: 'ADM-1' };

function setup(rows: Record<string, { status: string; retryCount: number; lastError: string | null }>) {
  const prisma: any = {
    blockchainTransaction: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = rows[where.donationId];
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) => (rows[where.donationId] ? { status: rows[where.donationId].status } : null)),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const worker = { kick: vi.fn() };
  const blockchain = { info: vi.fn(async (opts?: unknown) => ({ ready: true, opts })) };
  const controller = new IntegrityController({} as any, blockchain as any, prisma, audit as any, worker as any);
  return { controller, prisma, audit, worker, blockchain };
}

describe('POST admin/blockchain/:donationId/retry', () => {
  it('FAILED -> QUEUED (retryCount & lastError direset), audit BLOCKCHAIN_RETRY_REQUESTED, worker dipicu', async () => {
    const rows = { [DONATION]: { status: 'FAILED', retryCount: 5, lastError: '[INSUFFICIENT_FUNDS] insufficient funds' } };
    const { controller, audit, worker, prisma } = setup(rows);

    const res = await controller.retry(DONATION, ADMIN, '10.0.0.1', 'vitest');

    expect(res).toEqual({ donationId: DONATION, status: 'QUEUED' });
    expect(rows[DONATION]).toMatchObject({ status: 'QUEUED', retryCount: 0, lastError: null });
    // Klaim atomic: hanya baris yang MASIH FAILED yang diubah.
    expect(prisma.blockchainTransaction.updateMany.mock.calls[0][0].where).toEqual({ donationId: DONATION, status: 'FAILED' });
    expect(audit.log).toHaveBeenCalledWith({
      actorId: 'u-admin',
      action: 'BLOCKCHAIN_RETRY_REQUESTED',
      entityType: 'Donation',
      entityId: DONATION,
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
    });
    expect(worker.kick).toHaveBeenCalledTimes(1);
  });

  it.each(['QUEUED', 'SUBMITTED', 'RETRYING', 'CONFIRMED'])('status %s -> 409 BLOCKCHAIN_INVALID_STATUS, tanpa audit', async (status) => {
    const rows = { [DONATION]: { status, retryCount: 1, lastError: null } };
    const { controller, audit, worker } = setup(rows);

    await expect(controller.retry(DONATION, ADMIN, null, null)).rejects.toMatchObject({ code: 'BLOCKCHAIN_INVALID_STATUS', status: 409 });
    expect(rows[DONATION].status).toBe(status);
    expect(audit.log).not.toHaveBeenCalled();
    expect(worker.kick).not.toHaveBeenCalled();
  });

  it('donasi tanpa record notarisasi -> 404', async () => {
    const { controller, audit } = setup({});
    await expect(controller.retry(DONATION, ADMIN, null, null)).rejects.toMatchObject({ code: 'DONATION_NOT_FOUND', status: 404 });
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('guard endpoint retry (non-admin ditolak)', () => {
  const users: Record<string, { id: string; email: string; name: string; role: string; integritySubjectId: string; sessionVersion: number }> = {
    'u-student': { id: 'u-student', email: 's@x.id', name: 'Siswa', role: 'STUDENT', integritySubjectId: 'S-1', sessionVersion: 0 },
    'u-admin': { ...ADMIN, sessionVersion: 0 },
  };
  const fakePrisma = {
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) },
  } as unknown as PrismaService;
  const guard = new ActingUserGuard(new Reflector(), fakePrisma);

  function ctx(authorization?: string) {
    const req = {
      method: 'POST',
      header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
    } as Record<string, unknown>;
    return {
      getHandler: () => IntegrityController.prototype.retry,
      getClass: () => IntegrityController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
  });

  it('STUDENT -> 403 AUTH_FORBIDDEN', async () => {
    await expect(guard.canActivate(ctx(`Bearer ${createSessionToken('u-student')}`))).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      status: 403,
    });
  });

  it('tanpa login -> 401 AUTH_UNAUTHENTICATED', async () => {
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED', status: 401 });
  });

  it('ADMIN -> lolos', async () => {
    await expect(guard.canActivate(ctx(`Bearer ${createSessionToken('u-admin')}`))).resolves.toBe(true);
  });
});

describe('GET blockchain/info (publik)', () => {
  it('tidak menyertakan agregat biaya gas (khusus admin/stats)', async () => {
    const { controller, blockchain } = setup({});
    await controller.info();
    expect(blockchain.info).toHaveBeenCalledWith({ fees: false });
  });
});

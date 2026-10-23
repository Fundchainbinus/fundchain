import type { BlockchainTransaction } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dependency worker diganti stub: test tidak menyentuh DB, RPC, maupun Vercel.
vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/audit/audit.service', () => ({ AuditService: class {} }));
vi.mock('./modules/campaigns/campaigns.service', () => ({ CampaignsService: class {} }));
vi.mock('./modules/integrity/integrity.service', () => ({ IntegrityService: class {} }));
vi.mock('./modules/payments/payments.service', () => ({ PaymentsService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }));

import { NotarizationWorker } from './modules/blockchain/notarization.worker';

const SEPOLIA = 11155111;
const KEY = '0x' + 'aa'.repeat(32);
const HASH = '0x' + 'bb'.repeat(32);

type Job = BlockchainTransaction;

function makeJob(over: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: 'job-1',
    donationId: 'don-1',
    network: 'sepolia',
    chainId: SEPOLIA,
    contractAddress: null,
    onchainKey: KEY,
    txHash: null,
    status: 'QUEUED',
    blockNumber: null,
    retryCount: 0,
    lastError: null,
    nextAttemptAt: new Date(now.getTime() - 1000),
    submittedAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

// Hanya mendukung bentuk `where` yang dipakai worker.
function matches(job: Job, where: Record<string, any>): boolean {
  for (const [field, cond] of Object.entries(where)) {
    const value = (job as any)[field];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('lte' in cond && !(value !== null && value <= cond.lte)) return false;
      if ('lt' in cond && !(value !== null && value < cond.lt)) return false;
      if ('not' in cond && value === cond.not) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

// Prisma in-memory.
function createFakePrisma() {
  const jobs = new Map<string, Job>();
  const donations = new Map<string, { id: string; status: string; hash: string | null }>();
  const auditLogs: { action: string; entityId?: string | null; metadata?: any }[] = [];
  const prisma: any = {
    jobs,
    donations,
    auditLogs,
    auditLog: {
      findMany: vi.fn(async ({ where }: any) =>
        auditLogs.filter((l) => l.action === where.action && where.entityId.in.includes(l.entityId)),
      ),
    },
    blockchainTransaction: {
      findMany: vi.fn(async ({ where, take }: any) => {
        const rows = [...jobs.values()].filter((j) => matches(j, where)).map((j) => ({ ...j }));
        return take ? rows.slice(0, take) : rows;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const j of jobs.values()) {
          if (matches(j, where)) {
            Object.assign(j, data);
            count++;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const j = jobs.get(where.id);
        if (!j) throw new Error('job tidak ada');
        Object.assign(j, data);
        return { ...j };
      }),
    },
    donation: {
      findUnique: vi.fn(async ({ where }: any) => donations.get(where.id) ?? null),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };
  return prisma;
}

// Chain tiruan: `notarized` = key yang sudah tercatat on-chain.
function createFakeChain() {
  const notarized = new Set<string>();
  let sent = 0;
  const reader = { isNotarized: vi.fn(async (key: string) => notarized.has(key)) };
  const writer = {
    notarize: vi.fn(async (key: string, _hash: string) => {
      sent++;
      const hash = '0x' + String(sent).padStart(64, '0');
      return {
        hash,
        wait: vi.fn(async () => {
          notarized.add(key);
          return { status: 1, blockNumber: 100 + sent };
        }),
      };
    }),
  };
  const provider = {
    getTransaction: vi.fn(async (_hash: string): Promise<{ blockNumber: number | null } | null> => null),
    getTransactionReceipt: vi.fn(async (_hash: string): Promise<any> => null),
  };
  const chain: any = {
    notarized,
    reader,
    writer,
    provider,
    ready: true,
    target: () => ({ network: 'sepolia', chainId: SEPOLIA, contractAddress: '0xC0FFEE' }),
    health: vi.fn(async () => (chain.ready ? { ready: true } : { ready: false, reason: 'RPC tidak menjawab' })),
    contract: vi.fn((write?: boolean) => (write ? writer : reader)),
    getProvider: () => provider,
    parseRevert: vi.fn((e: any) => e?.revert?.name ?? null),
  };
  return chain;
}

function setup(jobOver: Partial<Job> = {}, donationStatus = 'PAID') {
  const prisma = createFakePrisma();
  const chain = createFakeChain();
  const audit = { log: vi.fn(async (entry: any) => void prisma.auditLogs.push(entry)) };
  const integrity = { verifyDonation: vi.fn(async () => undefined), verifyStale: vi.fn(async () => undefined) };
  const campaigns = { completeExpired: vi.fn(async () => 0), softDeleteFrozen: vi.fn(async () => 0) };
  const payments = { expireStale: vi.fn(async () => 0) };
  const job = makeJob(jobOver);
  prisma.jobs.set(job.id, job);
  prisma.donations.set(job.donationId, { id: job.donationId, status: donationStatus, hash: HASH });
  const worker = new NotarizationWorker(prisma, chain, integrity as any, campaigns as any, payments as any, audit as any);
  return { worker, prisma, chain, audit, job: prisma.jobs.get(job.id) as Job };
}

// Lewati jeda backoff tanpa menunggu sungguhan.
function makeDue(job: Job) {
  job.nextAttemptAt = new Date(Date.now() - 1000);
}

function auditActions(audit: any): string[] {
  return audit.log.mock.calls.map((call: any[]) => call[0].action);
}

beforeEach(() => {
  process.env.BLOCKCHAIN_CONFIRMATIONS = '2';
});

describe('NotarizationWorker: jalur sukses', () => {
  it('QUEUED -> CONFIRMED, menyimpan txHash dan blockNumber, menunggu 2 konfirmasi', async () => {
    const { worker, chain, job, audit } = setup();

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(chain.writer.notarize).toHaveBeenCalledWith(KEY, HASH);
    const tx = await chain.writer.notarize.mock.results[0].value;
    expect(tx.wait).toHaveBeenCalledWith(2, 45_000);
    expect(job.status).toBe('CONFIRMED');
    expect(job.txHash).toBe(tx.hash);
    expect(job.blockNumber).toBe(101);
    expect(job.confirmedAt).toBeInstanceOf(Date);
    expect(auditActions(audit)).toContain('BLOCKCHAIN_NOTARIZED');
  });

  it('memakai wallet relayer (contract mode tulis) untuk mengirim notarize', async () => {
    const { worker, chain } = setup();
    await worker.tick();
    expect(chain.contract).toHaveBeenCalledWith(true);
  });

  it('hanya mengambil job yang sudah jatuh tempo', async () => {
    const { worker, chain } = setup({ status: 'RETRYING', nextAttemptAt: new Date(Date.now() + 60_000) });
    await worker.tick();
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });

  it('mengabaikan job milik chain lain', async () => {
    const { worker, chain } = setup({ chainId: 31337 });
    await worker.tick();
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });
});

describe('NotarizationWorker: retry dan backoff', () => {
  it('error RPC saat kirim -> RETRYING dengan jeda 2 detik', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce(new Error('network timeout'));

    const before = Date.now();
    await worker.tick();

    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(1);
    expect(job.lastError).toContain('network timeout');
    const delay = job.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThan(3000);
  });

  it('jeda bertambah dua kali lipat: 2s, 4s, 8s, 16s', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValue(new Error('network timeout'));

    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      makeDue(job);
      const before = Date.now();
      await worker.tick();
      delays.push(Math.round((job.nextAttemptAt.getTime() - before) / 1000));
    }

    expect(delays).toEqual([2, 4, 8, 16]);
    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(4);
  });

  it('berhenti di percobaan ke-5 -> FAILED dan tercatat di audit log', async () => {
    const { worker, chain, job, audit } = setup();
    chain.writer.notarize.mockRejectedValue(new Error('network timeout'));

    for (let i = 0; i < 5; i++) {
      makeDue(job);
      await worker.tick();
    }

    expect(chain.writer.notarize).toHaveBeenCalledTimes(5);
    expect(job.status).toBe('FAILED');
    expect(job.retryCount).toBe(5);
    expect(auditActions(audit)).toContain('BLOCKCHAIN_NOTARIZE_FAILED');

    // FAILED tidak diambil lagi.
    makeDue(job);
    await worker.tick();
    expect(chain.writer.notarize).toHaveBeenCalledTimes(5);
  });

  it('pulih setelah RPC kembali normal -> CONFIRMED', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce(new Error('network timeout'));

    await worker.tick();
    expect(job.status).toBe('RETRYING');

    makeDue(job);
    await worker.tick();
    expect(job.status).toBe('CONFIRMED');
    expect(job.retryCount).toBe(1);
  });

  it('blockchain tidak siap -> ditunda tanpa menghabiskan jatah retry', async () => {
    const { worker, chain, job } = setup();
    chain.ready = false;

    for (let i = 0; i < 10; i++) await worker.tick();

    expect(chain.writer.notarize).not.toHaveBeenCalled();
    expect(job.status).toBe('QUEUED');
    expect(job.retryCount).toBe(0);
  });
});

describe('NotarizationWorker: idempotency dan replay', () => {
  it('hash sudah ada di chain -> CONFIRMED tanpa mengirim tx baru', async () => {
    const { worker, chain, job } = setup();
    chain.notarized.add(KEY);

    await worker.tick();

    expect(chain.writer.notarize).not.toHaveBeenCalled();
    expect(job.status).toBe('CONFIRMED');
  });

  it('revert AlreadyNotarized -> CONFIRMED, bukan retry', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ revert: { name: 'AlreadyNotarized' } });

    await worker.tick();

    expect(job.status).toBe('CONFIRMED');
    expect(job.retryCount).toBe(0);
  });

  it('revert ZeroHash -> langsung FAILED tanpa retry', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ revert: { name: 'ZeroHash' } });

    await worker.tick();

    expect(job.status).toBe('FAILED');
    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
  });

  it('kalah klaim (job sudah diambil instance lain) -> tidak mengirim tx', async () => {
    const { worker, chain, prisma } = setup();
    prisma.blockchainTransaction.updateMany.mockResolvedValueOnce({ count: 0 });

    await worker.tick();

    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });
});

describe('NotarizationWorker: tidak ada duplicate transaction', () => {
  it('tx lama masih pending -> tx baru tidak dikirim, retryCount tidak bertambah', async () => {
    const { worker, chain, job } = setup({ status: 'RETRYING', retryCount: 1, txHash: '0xlama' });
    chain.provider.getTransaction.mockResolvedValue({ blockNumber: null });

    await worker.tick();

    expect(chain.writer.notarize).not.toHaveBeenCalled();
    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(1);
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('status tx lama tidak bisa dicek (RPC error) -> tunda, tidak kirim ulang', async () => {
    const { worker, chain, job } = setup({ status: 'RETRYING', retryCount: 1, txHash: '0xlama' });
    chain.provider.getTransaction.mockRejectedValue(new Error('RPC timeout'));

    await worker.tick();

    expect(chain.writer.notarize).not.toHaveBeenCalled();
    expect(job.retryCount).toBe(1);
  });

  it('tx lama hilang dari node (dropped) -> aman kirim ulang', async () => {
    const { worker, chain, job } = setup({ status: 'RETRYING', retryCount: 1, txHash: '0xlama' });
    chain.provider.getTransaction.mockResolvedValue(null);

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('CONFIRMED');
  });

  it('tx lama sudah masuk blok tapi hash belum tercatat (revert) -> aman kirim ulang', async () => {
    const { worker, chain, job } = setup({ status: 'RETRYING', retryCount: 1, txHash: '0xlama' });
    chain.provider.getTransaction.mockResolvedValue({ blockNumber: 50 });

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('CONFIRMED');
  });

  it('RPC putus saat menunggu konfirmasi lalu tx lama masuk blok -> CONFIRMED tanpa tx kedua', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockImplementationOnce(async () => ({
      hash: '0xpertama',
      wait: async () => {
        throw new Error('connection reset');
      },
    }));

    await worker.tick();
    expect(job.status).toBe('RETRYING');
    expect(job.txHash).toBe('0xpertama');

    // tx pertama masih pending -> tidak boleh ada tx kedua
    chain.provider.getTransaction.mockResolvedValue({ blockNumber: null });
    makeDue(job);
    await worker.tick();
    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);

    // tx pertama akhirnya masuk blok
    chain.notarized.add(KEY);
    makeDue(job);
    await worker.tick();
    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('CONFIRMED');
    expect(job.txHash).toBe('0xpertama');
  });
});

describe('NotarizationWorker: invariant status donasi', () => {
  it('donasi bukan PAID -> job FAILED, dan worker tidak pernah mengubah tabel donasi', async () => {
    const { worker, chain, prisma, job } = setup({}, 'PENDING');

    await worker.tick();

    expect(job.status).toBe('FAILED');
    expect(chain.writer.notarize).not.toHaveBeenCalled();
    expect(prisma.donation.update).not.toHaveBeenCalled();
    expect(prisma.donation.updateMany).not.toHaveBeenCalled();
  });

  it('jalur sukses maupun gagal tidak mengubah status PAID', async () => {
    const { worker, chain, prisma, job } = setup();
    chain.writer.notarize.mockRejectedValue(new Error('network timeout'));

    for (let i = 0; i < 5; i++) {
      makeDue(job);
      await worker.tick();
    }

    expect(job.status).toBe('FAILED');
    expect(prisma.donations.get('don-1').status).toBe('PAID');
    expect(prisma.donation.update).not.toHaveBeenCalled();
  });
});

describe('NotarizationWorker: tx lambat tidak mengunci antrean', () => {
  function addJob(prisma: any, n: number) {
    const key = '0x' + String(n).repeat(64).slice(0, 64);
    prisma.jobs.set(`job-${n}`, makeJob({ id: `job-${n}`, donationId: `don-${n}`, onchainKey: key }));
    prisma.donations.set(`don-${n}`, { id: `don-${n}`, status: 'PAID', hash: HASH });
    return prisma.jobs.get(`job-${n}`) as Job;
  }

  it('receipt tidak datang dalam batas waktu -> job tetap SUBMITTED, job berikutnya tetap diproses', async () => {
    const { worker, chain, prisma, job } = setup();
    const second = addJob(prisma, 2);
    chain.writer.notarize.mockImplementationOnce(async () => ({
      hash: '0xlambat',
      wait: async () => {
        throw { code: 'TIMEOUT' };
      },
    }));

    await worker.tick();

    expect(job.status).toBe('SUBMITTED');
    expect(job.txHash).toBe('0xlambat');
    expect(job.retryCount).toBe(0);
    expect(second.status).toBe('CONFIRMED');
    expect(chain.writer.notarize).toHaveBeenCalledTimes(2);
  });

  it('tx yang timeout dikonfirmasi tick berikutnya begitu receipt cukup konfirmasi', async () => {
    const { worker, chain, job } = setup({
      status: 'SUBMITTED',
      txHash: '0xlambat',
      submittedAt: new Date(Date.now() - 30_000),
    });
    chain.provider.getTransactionReceipt.mockResolvedValue({ status: 1, blockNumber: 77, confirmations: async () => 2 });

    await worker.tick();

    expect(job.status).toBe('CONFIRMED');
    expect(job.blockNumber).toBe(77);
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });

  it('error selain timeout saat menunggu receipt tetap masuk RETRYING', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockImplementationOnce(async () => ({
      hash: '0xputus',
      wait: async () => {
        throw new Error('connection reset');
      },
    }));

    await worker.tick();

    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(1);
  });
});

describe('NotarizationWorker: alert notarisasi macet > 10 menit', () => {
  const OLD = () => new Date(Date.now() - 11 * 60_000);
  const stuckLogs = (prisma: any) => prisma.auditLogs.filter((l: any) => l.action === 'BLOCKCHAIN_TX_STUCK');

  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 204 }));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  it('belum CONFIRMED > 10 menit -> audit BLOCKCHAIN_TX_STUCK + alert ke webhook', async () => {
    const { worker, prisma } = setup({
      status: 'RETRYING',
      retryCount: 2,
      createdAt: OLD(),
      lastError: 'network timeout',
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    await worker.tick();

    const logs = stuckLogs(prisma);
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe('don-1');
    expect(logs[0].metadata.status).toBe('RETRYING');
    expect(logs[0].metadata.ageMinutes).toBeGreaterThanOrEqual(11);
    const fetchMock = (globalThis as any).fetch;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toContain('don-1');
    expect(body.content).toContain('network timeout');
  });

  it('tetap terdeteksi walaupun RPC sedang mati', async () => {
    const { worker, chain, prisma } = setup({ createdAt: OLD() });
    chain.ready = false;

    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(1);
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });

  it('alert hanya sekali per donasi', async () => {
    const { worker, prisma } = setup({ status: 'RETRYING', createdAt: OLD(), nextAttemptAt: new Date(Date.now() + 60_000) });

    await worker.tick();
    (worker as any).lastStuckCheck = 0;
    await worker.tick();
    (worker as any).lastStuckCheck = 0;
    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(1);
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('job yang belum 10 menit tidak di-alert', async () => {
    const { worker, chain, prisma } = setup({ createdAt: new Date(Date.now() - 5 * 60_000) });
    chain.ready = false;

    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(0);
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('job CONFIRMED / FAILED lama tidak di-alert', async () => {
    const { worker, prisma } = setup({ status: 'FAILED', createdAt: OLD() });
    prisma.jobs.set('job-2', makeJob({ id: 'job-2', donationId: 'don-2', status: 'CONFIRMED', createdAt: OLD() }));

    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(0);
  });

  it('webhook gagal tidak menghentikan worker', async () => {
    const { worker, prisma, job } = setup({ createdAt: OLD() });
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('discord down');
    });

    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(1);
    expect(job.status).toBe('CONFIRMED');
  });

  it('tanpa ALERT_WEBHOOK_URL alert cukup tercatat di audit & log', async () => {
    process.env.ALERT_WEBHOOK_URL = '';
    const { worker, chain, prisma } = setup({ createdAt: OLD() });
    chain.ready = false;

    await worker.tick();

    expect(stuckLogs(prisma)).toHaveLength(1);
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });
});

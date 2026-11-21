import type { BlockchainTransaction } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BFD-48 / BFD-49 / BFD-92: worker diuji dengan Prisma & chain tiruan. Tidak ada RPC, DB, private key, atau tx sungguhan.
vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/audit/audit.service', () => ({ AuditService: class {} }));
vi.mock('./modules/campaigns/campaigns.service', () => ({ CampaignsService: class {} }));
vi.mock('./modules/integrity/integrity.service', () => ({ IntegrityService: class {} }));
vi.mock('./modules/payments/payments.service', () => ({ PaymentsService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }));

import { env } from './common/env';
import { gasFields, INSUFFICIENT_FUNDS_PAUSE_MS, NotarizationWorker } from './modules/blockchain/notarization.worker';

const SEPOLIA = 11155111;
const KEY = '0x' + 'aa'.repeat(32);
const HASH = '0x' + 'bb'.repeat(32);
const GAS_USED = 48_123n;
const GAS_PRICE = 1_500_000_007n;

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
    gasUsed: null,
    effectiveGasPrice: null,
    feeWei: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Job;
}

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
    donation: { findUnique: vi.fn(async ({ where }: any) => donations.get(where.id) ?? null), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };
  return prisma;
}

function createFakeChain() {
  const notarized = new Set<string>();
  let sent = 0;
  const reader = { isNotarized: vi.fn(async (key: string) => notarized.has(key)) };
  const notarize: any = vi.fn(async (key: string, _hash: string, _overrides?: any) => {
    sent++;
    const hash = '0x' + String(sent).padStart(64, '0');
    return {
      hash,
      wait: vi.fn(async () => {
        notarized.add(key);
        return { status: 1, blockNumber: 100 + sent, gasUsed: GAS_USED, gasPrice: GAS_PRICE };
      }),
    };
  });
  notarize.estimateGas = vi.fn(async () => 60_000n);
  const writer = { notarize };
  const provider = {
    getTransaction: vi.fn(async (): Promise<any> => null),
    getTransactionReceipt: vi.fn(async (): Promise<any> => null),
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
    getRelayer: () => ({ address: '0x00000000000000000000000000000000000000Re' }),
    parseRevert: vi.fn((e: any) => e?.revert?.name ?? null),
    pendingNonce: vi.fn(async () => 7),
    feeData: vi.fn(async () => ({ maxFeePerGas: 2_000n, maxPriorityFeePerGas: 100n, gasPrice: 1_000n })),
    relayerBalance: vi.fn(async () => ({ address: '0xRelayer', balance: '1.0', lowBalance: false, minBalance: '0.02' })),
  };
  return chain;
}

function setup(jobOver: Partial<Job> = {}) {
  const prisma = createFakePrisma();
  const chain = createFakeChain();
  const audit = { log: vi.fn(async (entry: any) => void prisma.auditLogs.push(entry)) };
  const integrity = { verifyDonation: vi.fn(async () => undefined), verifyStale: vi.fn(async () => undefined) };
  const campaigns = { completeExpired: vi.fn(async () => 0), softDeleteFrozen: vi.fn(async () => 0) };
  const payments = { expireStale: vi.fn(async () => 0) };
  const job = makeJob(jobOver);
  prisma.jobs.set(job.id, job);
  prisma.donations.set(job.donationId, { id: job.donationId, status: 'PAID', hash: HASH });
  const worker = new NotarizationWorker(prisma, chain, integrity as any, campaigns as any, payments as any, audit as any);
  return { worker, prisma, chain, audit, job: prisma.jobs.get(job.id) as Job };
}

function addJob(prisma: any, n: number) {
  const key = '0x' + String(n).repeat(64).slice(0, 64);
  prisma.jobs.set(`job-${n}`, makeJob({ id: `job-${n}`, donationId: `don-${n}`, onchainKey: key }));
  prisma.donations.set(`don-${n}`, { id: `don-${n}`, status: 'PAID', hash: HASH });
  return prisma.jobs.get(`job-${n}`) as Job;
}

function makeDue(job: Job) {
  job.nextAttemptAt = new Date(Date.now() - 1000);
}

const auditActions = (audit: any): string[] => audit.log.mock.calls.map((c: any[]) => c[0].action);

const savedEnv = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.CHAIN_ID = String(SEPOLIA);
  process.env.BLOCKCHAIN_CONFIRMATIONS = '2';
  process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
  (globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 204 }));
});

afterEach(() => {
  process.env = { ...savedEnv };
  globalThis.fetch = realFetch;
});

describe('BFD-48: block confirmations', () => {
  it('default 2 bila BLOCKCHAIN_CONFIRMATIONS tidak di-set (Sepolia)', () => {
    delete process.env.BLOCKCHAIN_CONFIRMATIONS;
    expect(env().blockchain.confirmations).toBe(2);
    process.env.BLOCKCHAIN_CONFIRMATIONS = '';
    expect(env().blockchain.confirmations).toBe(2);
  });

  it('Hardhat lokal (31337, automine) default 1; nilai eksplisit tetap dipakai; minimal 1', () => {
    delete process.env.BLOCKCHAIN_CONFIRMATIONS;
    process.env.CHAIN_ID = '31337';
    expect(env().blockchain.confirmations).toBe(1);
    process.env.BLOCKCHAIN_CONFIRMATIONS = '3';
    expect(env().blockchain.confirmations).toBe(3);
    process.env.BLOCKCHAIN_CONFIRMATIONS = '0';
    expect(env().blockchain.confirmations).toBe(1);
    process.env.BLOCKCHAIN_CONFIRMATIONS = '-4';
    expect(env().blockchain.confirmations).toBe(1);
  });

  it('worker menunggu jumlah konfirmasi yang dikonfigurasi saat tx.wait()', async () => {
    process.env.BLOCKCHAIN_CONFIRMATIONS = '5';
    process.env.BLOCKCHAIN_CONFIRM_WAIT_MS = '30000';
    const { worker, chain, job } = setup();

    await worker.tick();

    const tx = await chain.writer.notarize.mock.results[0].value;
    expect(tx.wait).toHaveBeenCalledWith(5, 30_000);
    expect(job.status).toBe('CONFIRMED');
  });

  it('default tanpa env: tx.wait(2, ...) di Sepolia', async () => {
    delete process.env.BLOCKCHAIN_CONFIRMATIONS;
    const { worker, chain } = setup();
    await worker.tick();
    const tx = await chain.writer.notarize.mock.results[0].value;
    expect(tx.wait).toHaveBeenCalledWith(2, 45_000);
  });

  it('recoverStuck: receipt baru 1 konfirmasi -> tetap SUBMITTED; setelah 2 -> CONFIRMED', async () => {
    const { worker, chain, job } = setup({ status: 'SUBMITTED', txHash: '0xlambat', submittedAt: new Date(Date.now() - 30_000) });
    let confs = 1;
    chain.provider.getTransactionReceipt.mockImplementation(async () => ({
      status: 1,
      blockNumber: 77,
      gasUsed: GAS_USED,
      gasPrice: GAS_PRICE,
      confirmations: async () => confs,
    }));

    await worker.tick();
    expect(job.status).toBe('SUBMITTED');

    confs = 2;
    await worker.tick();
    expect(job.status).toBe('CONFIRMED');
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });

  it('SUBMITTED > 2 menit & hash sudah on-chain tapi konfirmasi kurang -> belum CONFIRMED', async () => {
    const { worker, chain, job } = setup({ status: 'SUBMITTED', txHash: '0xlama', submittedAt: new Date(Date.now() - 5 * 60_000) });
    chain.notarized.add(KEY);
    let confs = 1;
    // recoverStuck bagian pertama dilewati dengan receipt null; bagian "macet" membaca receipt dengan konfirmasi.
    chain.provider.getTransactionReceipt
      .mockImplementationOnce(async () => null)
      .mockImplementation(async () => ({ status: 1, blockNumber: 90, confirmations: async () => confs }));

    await worker.tick();
    expect(job.status).toBe('SUBMITTED');

    confs = 3;
    await worker.tick();
    expect(job.status).toBe('CONFIRMED');
  });

  it('idempotency: hash on-chain dari tx kita sendiri tetap menunggu N konfirmasi', async () => {
    const { worker, chain, job } = setup({ status: 'RETRYING', txHash: '0xmilikku', retryCount: 1 });
    chain.notarized.add(KEY);
    chain.provider.getTransactionReceipt.mockResolvedValue({ status: 1, blockNumber: 55, confirmations: async () => 1 });

    await worker.tick();

    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(1);
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(chain.writer.notarize).not.toHaveBeenCalled();
  });
});

describe('BFD-49: penanganan error relayer di worker', () => {
  it('NONCE_TOO_LOW (ethers NONCE_EXPIRED) -> kirim ulang langsung dengan nonce pending baru, tanpa menghabiskan retry', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ code: 'NONCE_EXPIRED', shortMessage: 'nonce has already been used' });

    await worker.tick();

    expect(chain.pendingNonce).toHaveBeenCalledTimes(1);
    expect(chain.writer.notarize).toHaveBeenCalledTimes(2);
    expect(chain.writer.notarize.mock.calls[1]).toEqual([KEY, HASH, { nonce: 7 }]);
    expect(chain.feeData).not.toHaveBeenCalled();
    expect(job.status).toBe('CONFIRMED');
    expect(job.retryCount).toBe(0);
  });

  it('NONCE_CONFLICT (pesan node "nonce too high") -> nonce pending baru', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce(new Error('could not coalesce error (error={ "message": "nonce too high" })'));

    await worker.tick();

    expect(chain.writer.notarize.mock.calls[1][2]).toEqual({ nonce: 7 });
    expect(job.status).toBe('CONFIRMED');
  });

  it('REPLACEMENT_UNDERPRICED -> nonce baru, fee TIDAK dinaikkan di nonce lama (tidak menggusur tx lain)', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ code: 'REPLACEMENT_UNDERPRICED', shortMessage: 'replacement fee too low' });

    await worker.tick();

    expect(chain.writer.notarize.mock.calls[1][2]).toEqual({ nonce: 7 });
    expect(chain.feeData).not.toHaveBeenCalled();
    expect(job.status).toBe('CONFIRMED');
  });

  it('GAS_UNDERPRICED -> kirim ulang dengan maxFeePerGas & priority fee naik 25%', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ info: { error: { code: -32000, message: 'transaction underpriced' } } });

    await worker.tick();

    expect(chain.writer.notarize.mock.calls[1][2]).toEqual({ maxFeePerGas: 2_500n, maxPriorityFeePerGas: 125n });
    expect(chain.pendingNonce).not.toHaveBeenCalled();
    expect(job.status).toBe('CONFIRMED');
  });

  it('GAS_UNDERPRICED berulang -> fee naik bertahap dari fee percobaan sebelumnya', async () => {
    const { worker, chain } = setup();
    const underpriced = { shortMessage: 'max fee per gas less than block base fee' };
    chain.writer.notarize.mockRejectedValueOnce(underpriced).mockRejectedValueOnce(underpriced);

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(3);
    expect(chain.writer.notarize.mock.calls[2][2]).toEqual({ maxFeePerGas: 3_125n, maxPriorityFeePerGas: 157n });
  });

  it('GAS_TOO_LOW -> estimasi ulang gas limit + headroom 50%', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce(new Error('intrinsic gas too low'));

    await worker.tick();

    expect(chain.writer.notarize.estimateGas).toHaveBeenCalledWith(KEY, HASH);
    expect(chain.writer.notarize.mock.calls[1][2]).toEqual({ gasLimit: 90_000n });
    expect(job.status).toBe('CONFIRMED');
  });

  it('error nonce menetap -> RETRYING dengan kategori di lastError; tick berikutnya langsung pakai nonce baru', async () => {
    const { worker, chain, job } = setup();
    const nonceErr = { code: 'NONCE_EXPIRED', shortMessage: 'nonce too low' };
    chain.writer.notarize.mockRejectedValueOnce(nonceErr).mockRejectedValueOnce(nonceErr).mockRejectedValueOnce(nonceErr);

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(3); // 1 kirim + 2 perbaikan
    expect(job.status).toBe('RETRYING');
    expect(job.retryCount).toBe(1);
    expect(job.lastError).toBe('[NONCE_TOO_LOW] nonce too low');

    chain.pendingNonce.mockResolvedValue(9);
    makeDue(job);
    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(4);
    expect(chain.writer.notarize.mock.calls[3]).toEqual([KEY, HASH, { nonce: 9 }]);
    expect(job.status).toBe('CONFIRMED');
  });

  it('INSUFFICIENT_FUNDS -> FAILED tanpa menambah retryCount, audit, alert, dan sisa batch tidak dikirim', async () => {
    const { worker, chain, prisma, job, audit } = setup({ retryCount: 1, status: 'RETRYING' });
    const second = addJob(prisma, 2);
    chain.writer.notarize.mockRejectedValueOnce({
      code: 'INSUFFICIENT_FUNDS',
      shortMessage: 'insufficient funds for intrinsic transaction cost',
    });

    await worker.tick();

    expect(job.status).toBe('FAILED');
    expect(job.retryCount).toBe(1);
    expect(job.lastError).toBe('[INSUFFICIENT_FUNDS] insufficient funds for intrinsic transaction cost');
    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(chain.pendingNonce).not.toHaveBeenCalled();
    expect(second.status).toBe('QUEUED');
    expect(auditActions(audit)).toContain('BLOCKCHAIN_NOTARIZE_FAILED');
    const fetchMock = (globalThis as any).fetch;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toContain('Saldo relayer tidak cukup');
  });

  it('INSUFFICIENT_FUNDS -> pengiriman dijeda; setelah jeda antrean lanjut lagi', async () => {
    const { worker, chain, prisma } = setup();
    const second = addJob(prisma, 2);
    chain.writer.notarize.mockRejectedValueOnce(new Error('insufficient funds for gas * price + value'));

    await worker.tick();
    await worker.tick();
    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('QUEUED');

    (worker as any).fundsPausedUntil = Date.now() - 1;
    await worker.tick();
    expect(second.status).toBe('CONFIRMED');
    expect(INSUFFICIENT_FUNDS_PAUSE_MS).toBe(10 * 60_000);
  });

  it('ALREADY_KNOWN -> tidak dikirim ulang (cegah tx dobel), job tetap SUBMITTED untuk recoverStuck', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ info: { error: { message: 'already known' } } });

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('SUBMITTED');
    expect(job.retryCount).toBe(0);
    expect(job.lastError).toMatch(/^\[ALREADY_KNOWN\]/);
  });

  it('error tak dikenal tetap retry backoff biasa tanpa prefix kategori', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce(new Error('socket hang up'));

    await worker.tick();

    expect(chain.writer.notarize).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('RETRYING');
    expect(job.lastError).toBe('socket hang up');
  });

  it('revert contract didahulukan dari klasifikasi relayer', async () => {
    const { worker, chain, job } = setup();
    chain.writer.notarize.mockRejectedValueOnce({ revert: { name: 'ZeroHash' }, code: 'INSUFFICIENT_FUNDS' });

    await worker.tick();

    expect(job.status).toBe('FAILED');
    expect(job.lastError).toContain('ZeroHash');
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });
});

describe('BFD-73: saldo relayer rendah di worker', () => {
  it('lowBalance -> warning di log, dicek ulang paling cepat tiap BALANCE_CHECK_MS', async () => {
    const { worker, chain } = setup();
    chain.relayerBalance.mockResolvedValue({ address: '0xRelayer', balance: '0.005', lowBalance: true, minBalance: '0.02' });
    const warn = vi.spyOn((worker as any).logger, 'warn');

    await worker.tick();
    await worker.tick();

    expect(chain.relayerBalance).toHaveBeenCalledTimes(1);
    const lowWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('rendah'));
    expect(lowWarnings).toHaveLength(1);
    expect(String(lowWarnings[0][0])).toContain('0.005');
    // Hanya log: tidak mengirim webhook (alert Discord saldo = workflow relayer-balance.yml).
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('cek saldo gagal (RPC) tidak menghentikan antrean', async () => {
    const { worker, chain, job } = setup();
    chain.relayerBalance.mockRejectedValue(new Error('RPC down'));
    await worker.tick();
    expect(job.status).toBe('CONFIRMED');
  });
});

describe('BFD-92: biaya gas disimpan saat CONFIRMED', () => {
  it('menyimpan gasUsed, effectiveGasPrice, feeWei (string wei) dari receipt', async () => {
    const { worker, job, audit } = setup();

    await worker.tick();

    expect(job.status).toBe('CONFIRMED');
    expect(job.gasUsed).toBe(GAS_USED.toString());
    expect(job.effectiveGasPrice).toBe(GAS_PRICE.toString());
    expect(job.feeWei).toBe((GAS_USED * GAS_PRICE).toString());
    const notarized = audit.log.mock.calls.find((c: any[]) => c[0].action === 'BLOCKCHAIN_NOTARIZED')[0];
    expect(notarized.metadata.feeWei).toBe((GAS_USED * GAS_PRICE).toString());
  });

  it('recoverStuck juga menyimpan biaya dari receipt provider', async () => {
    const { worker, chain, job } = setup({ status: 'SUBMITTED', txHash: '0xlambat', submittedAt: new Date(Date.now() - 30_000) });
    chain.provider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      blockNumber: 77,
      gasUsed: 50_000n,
      gasPrice: 3n,
      confirmations: async () => 2,
    });

    await worker.tick();

    expect(job.status).toBe('CONFIRMED');
    expect(job.feeWei).toBe('150000');
  });

  it('CONFIRMED tanpa receipt (hash sudah on-chain) -> kolom biaya null', async () => {
    const { worker, chain, job } = setup();
    chain.notarized.add(KEY);

    await worker.tick();

    expect(job.status).toBe('CONFIRMED');
    expect(job.gasUsed).toBeNull();
    expect(job.feeWei).toBeNull();
  });

  it('gasFields: receipt tanpa field gas -> null, tidak melempar', () => {
    expect(gasFields(null)).toEqual({ gasUsed: null, effectiveGasPrice: null, feeWei: null });
    expect(gasFields({ gasUsed: 21_000n })).toEqual({ gasUsed: '21000', effectiveGasPrice: null, feeWei: null });
    expect(gasFields({ gasUsed: 2n ** 70n, gasPrice: 2n ** 70n }).feeWei).toBe((2n ** 140n).toString());
  });
});

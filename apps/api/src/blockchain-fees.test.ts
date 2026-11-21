import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BFD-92: agregat biaya gas di BlockchainService. Prisma tiruan; tidak ada DB / RPC.
vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));

import { BlockchainService, toWei } from './modules/blockchain/blockchain.service';

/** Tiruan Prisma.Decimal: toString() bisa notasi eksponen untuk angka besar, toFixed(0) tidak. */
class FakeDecimal {
  constructor(private readonly digits: string) {}
  toFixed(_dp: number) {
    return this.digits;
  }
  toString() {
    return this.digits.length > 21 ? `${this.digits[0]}.${this.digits.slice(1)}e+${this.digits.length - 1}` : this.digits;
  }
}
const dec = (v: string) => new FakeDecimal(v);

const SEPOLIA = 11155111;
const savedEnv = { ...process.env };

function setup(rows: { all: any; recent: any } | Error) {
  const aggregate = vi.fn(async ({ where }: any) => {
    if (rows instanceof Error) throw rows;
    return where.confirmedAt ? rows.recent : rows.all;
  });
  const prisma: any = { blockchainTransaction: { aggregate } };
  const service = new BlockchainService(prisma);
  return { service, aggregate };
}

beforeEach(() => {
  process.env.CHAIN_ID = String(SEPOLIA);
  process.env.CONTRACT_ADDRESS = '0x' + '11'.repeat(20);
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('BlockchainService.feeStats', () => {
  it('count, total fee ETH, rata-rata per notarisasi, dan 24 jam terakhir', async () => {
    const { service, aggregate } = setup({
      all: {
        _count: { _all: 4 },
        _sum: { feeWei: dec('400000000000000'), gasUsed: dec('200000') },
      },
      recent: { _count: { _all: 1 }, _sum: { feeWei: dec('100000000000000') } },
    });
    const now = new Date('2026-11-21T12:00:00Z');

    const stats = await service.feeStats(now);

    expect(stats).toEqual({
      count: 4,
      totalFeeEth: '0.0004',
      avgFeeEth: '0.0001',
      totalGasUsed: '200000',
      last24h: { count: 1, totalFeeEth: '0.0001', avgFeeEth: '0.0001' },
    });
    // Hanya baris CONFIRMED di chain aktif yang punya data biaya; 24 jam dihitung dari confirmedAt.
    const [allCall, recentCall] = aggregate.mock.calls.map((c) => c[0]);
    expect(allCall.where).toEqual({ status: 'CONFIRMED', chainId: SEPOLIA, feeWei: { not: null } });
    expect(recentCall.where.confirmedAt.gte).toEqual(new Date('2026-11-20T12:00:00Z'));
  });

  it('belum ada data biaya -> nol, rata-rata null', async () => {
    const { service } = setup({
      all: { _count: { _all: 0 }, _sum: { feeWei: null, gasUsed: null } },
      recent: { _count: { _all: 0 }, _sum: { feeWei: null } },
    });
    const stats = await service.feeStats();
    expect(stats).toMatchObject({ count: 0, totalFeeEth: '0.0', avgFeeEth: null, last24h: { count: 0, avgFeeEth: null } });
  });

  it('query gagal (mis. migration belum jalan) -> null, tidak melempar', async () => {
    const { service } = setup(new Error('column "fee_wei" does not exist'));
    await expect(service.feeStats()).resolves.toBeNull();
  });
});

describe('toWei', () => {
  it('Decimal besar tidak kehilangan presisi / notasi eksponen', () => {
    expect(toWei(dec('123456789012345678901234567890'))).toBe(123456789012345678901234567890n);
    expect(toWei('42')).toBe(42n);
    expect(toWei(null)).toBe(0n);
  });
});

describe('BlockchainService.info', () => {
  function withChain(service: BlockchainService) {
    vi.spyOn(service, 'health').mockResolvedValue({ ready: true });
    vi.spyOn(service, 'relayerBalance').mockResolvedValue({ address: '0xR', balance: '0.5', lowBalance: false, minBalance: '0.02' });
    return service;
  }

  it('admin (default) menyertakan fees; publik (fees: false) tidak menyentuh DB', async () => {
    const { service, aggregate } = setup({
      all: { _count: { _all: 0 }, _sum: { feeWei: null, gasUsed: null } },
      recent: { _count: { _all: 0 }, _sum: { feeWei: null } },
    });
    withChain(service);

    const admin = await service.info();
    expect(admin).toHaveProperty('fees');
    expect(admin.relayer).toMatchObject({ lowBalance: false });

    aggregate.mockClear();
    const pub = await service.info({ fees: false });
    expect(pub).not.toHaveProperty('fees');
    expect(aggregate).not.toHaveBeenCalled();
  });
});

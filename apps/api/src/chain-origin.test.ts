import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReadRpcs } from './common/env';
import { BlockchainService } from './modules/blockchain/blockchain.service';

const CURRENT = '0x1111111111111111111111111111111111111111';
const OLD = '0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2';

function service() {
  vi.stubEnv('BLOCKCHAIN_NETWORK', 'binusian');
  vi.stubEnv('CHAIN_ID', '2026');
  vi.stubEnv('BLOCKCHAIN_RPC_URL', 'http://127.0.0.1:9');
  vi.stubEnv('CONTRACT_ADDRESS', CURRENT);
  return new BlockchainService({} as never);
}

describe('pindah jaringan: bukti lama tetap dibaca dari chain asalnya', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('parseReadRpcs: Sepolia publik default + tambahan dari env', () => {
    expect(parseReadRpcs(undefined)[11155111]).toMatch(/^https:\/\//);
    const r = parseReadRpcs('2026=http://10.0.0.5:8545, 80002=https://rpc.example.test ,rusak');
    expect(r[2026]).toBe('http://10.0.0.5:8545');
    expect(r[80002]).toBe('https://rpc.example.test');
    expect(Object.keys(r)).toHaveLength(3);
  });

  it('donasi di chain aktif → kontrak aktif; donasi Sepolia → kontrak Sepolia di RPC baca', () => {
    const s = service() as unknown as { readContractFor(o?: object): { target: string; runner: { _network?: { chainId: bigint } } } };
    expect(s.readContractFor({ chainId: 2026, contractAddress: CURRENT }).target).toBe(CURRENT);
    expect(s.readContractFor(undefined).target).toBe(CURRENT);
    const old = s.readContractFor({ chainId: 11155111, contractAddress: OLD });
    expect(old.target).toBe(OLD);
  });

  it('chain lama tanpa RPC baca → error jelas, bukan dianggap belum dinotarisasi', () => {
    const s = service();
    expect(() => (s as never as { readContractFor(o: object): unknown }).readContractFor({ chainId: 999, contractAddress: OLD })).toThrow(
      /BLOCKCHAIN_READ_RPCS/,
    );
  });

  it('explorer kustom hanya untuk chain aktif; tx Sepolia tetap ke Etherscan', () => {
    vi.stubEnv('BLOCKCHAIN_EXPLORER_URL', 'https://explorer.binusian.example/');
    const s = service();
    expect(s.explorerTx(2026, '0xabc')).toBe('https://explorer.binusian.example/tx/0xabc');
    expect(s.explorerTx(11155111, '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc');
  });
});

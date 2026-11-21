import { describe, expect, it } from 'vitest';
import {
  bumpFees,
  classifyRelayerError,
  errorClassFromLastError,
  formatRelayerError,
  RELAYER_ERROR_HANDLING,
  relayerErrorMessage,
} from './modules/blockchain/relayer-errors';

// BFD-49: klasifikasi error kirim tx relayer. Bentuk error meniru ethers v6 (code + shortMessage + info.error dari RPC).
describe('classifyRelayerError', () => {
  it.each([
    // kode ethers v6
    [{ code: 'INSUFFICIENT_FUNDS', shortMessage: 'insufficient funds for intrinsic transaction cost' }, 'INSUFFICIENT_FUNDS'],
    [{ code: 'NONCE_EXPIRED', shortMessage: 'nonce has already been used' }, 'NONCE_TOO_LOW'],
    [{ code: 'REPLACEMENT_UNDERPRICED', shortMessage: 'replacement fee too low' }, 'REPLACEMENT_UNDERPRICED'],
    // pesan node (geth / Hardhat / Besu / Nethermind) yang tidak dipetakan ethers
    [new Error('insufficient funds for gas * price + value'), 'INSUFFICIENT_FUNDS'],
    [{ info: { error: { code: -32000, message: 'nonce too low: next nonce 12, tx nonce 11' } } }, 'NONCE_TOO_LOW'],
    [new Error('Nonce too low. Expected nonce to be 5 but got 4.'), 'NONCE_TOO_LOW'],
    [{ error: { message: 'NONCE_TOO_LOW' } }, 'NONCE_TOO_LOW'],
    [new Error('Nonce too high. Expected nonce to be 5 but got 9.'), 'NONCE_CONFLICT'],
    [{ error: { message: 'NonceGap, Future nonce' } }, 'NONCE_CONFLICT'],
    [{ info: { error: { message: 'replacement transaction underpriced' } } }, 'REPLACEMENT_UNDERPRICED'],
    [{ info: { error: { message: 'already known' } } }, 'ALREADY_KNOWN'],
    [new Error('known transaction: 0xabc'), 'ALREADY_KNOWN'],
    [{ info: { error: { message: 'transaction underpriced' } } }, 'GAS_UNDERPRICED'],
    [new Error('max fee per gas less than block base fee: address 0x.., maxFeePerGas: 1 baseFee: 2'), 'GAS_UNDERPRICED'],
    [{ shortMessage: 'could not coalesce error', error: { message: 'FeeTooLow' } }, 'GAS_UNDERPRICED'],
    [new Error('intrinsic gas too low'), 'GAS_TOO_LOW'],
    [{ cause: { message: 'gas limit too low' } }, 'GAS_TOO_LOW'],
  ])('%o -> %s', (error, expected) => {
    expect(classifyRelayerError(error)).toBe(expected);
  });

  it.each([[new Error('socket hang up')], [{ code: 'TIMEOUT' }], [null], [undefined], ['']])(
    'bukan error relayer -> null (%o)',
    (error) => {
      expect(classifyRelayerError(error)).toBeNull();
    },
  );

  it('kode ethers didahulukan dari teks pesan', () => {
    expect(classifyRelayerError({ code: 'INSUFFICIENT_FUNDS', message: 'nonce too low' })).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('penanganan per kategori', () => {
  it('nonce & replacement -> nonce baru; underpriced -> fee naik; gas too low -> gas limit; funds -> terminal', () => {
    expect(RELAYER_ERROR_HANDLING.NONCE_TOO_LOW).toMatchObject({ freshNonce: true, bumpFee: false, terminal: false });
    expect(RELAYER_ERROR_HANDLING.NONCE_CONFLICT).toMatchObject({ freshNonce: true, terminal: false });
    expect(RELAYER_ERROR_HANDLING.REPLACEMENT_UNDERPRICED).toMatchObject({ freshNonce: true, bumpFee: false });
    expect(RELAYER_ERROR_HANDLING.GAS_UNDERPRICED).toMatchObject({ bumpFee: true, freshNonce: false });
    expect(RELAYER_ERROR_HANDLING.GAS_TOO_LOW).toMatchObject({ bumpGasLimit: true });
    expect(RELAYER_ERROR_HANDLING.INSUFFICIENT_FUNDS).toMatchObject({ terminal: true, freshNonce: false, bumpFee: false });
    expect(RELAYER_ERROR_HANDLING.ALREADY_KNOWN).toMatchObject({ freshNonce: false, bumpFee: false, terminal: false });
  });

  it('kategori disimpan sebagai prefix lastError dan bisa dibaca balik', () => {
    const stored = formatRelayerError('NONCE_TOO_LOW', 'nonce too low');
    expect(stored).toBe('[NONCE_TOO_LOW] nonce too low');
    expect(errorClassFromLastError(stored)).toBe('NONCE_TOO_LOW');
    expect(errorClassFromLastError('network timeout')).toBeNull();
    expect(errorClassFromLastError('[BUKAN_KATEGORI] x')).toBeNull();
    expect(errorClassFromLastError(null)).toBeNull();
    expect(formatRelayerError(null, 'socket hang up')).toBe('socket hang up');
  });

  it('relayerErrorMessage memakai shortMessage ethers bila ada', () => {
    expect(relayerErrorMessage({ shortMessage: 'nonce too low', message: 'nonce too low (action="sendTransaction", data=...)' })).toBe(
      'nonce too low',
    );
    expect(relayerErrorMessage(new Error('x'))).toBe('x');
  });
});

describe('bumpFees', () => {
  it('EIP-1559: fee jaringan × 1.25 (dibulatkan ke atas)', () => {
    expect(bumpFees({ maxFeePerGas: 2_000n, maxPriorityFeePerGas: 101n, gasPrice: 1_000n })).toEqual({
      maxFeePerGas: 2_500n,
      maxPriorityFeePerGas: 127n,
    });
  });

  it('memakai fee percobaan sebelumnya bila lebih tinggi dari fee jaringan', () => {
    expect(
      bumpFees({ maxFeePerGas: 1_000n, maxPriorityFeePerGas: 10n, gasPrice: null }, { maxFeePerGas: 4_000n, maxPriorityFeePerGas: 400n }),
    ).toEqual({ maxFeePerGas: 5_000n, maxPriorityFeePerGas: 500n });
  });

  it('maxFeePerGas tidak pernah di bawah priority fee', () => {
    const fees = bumpFees({ maxFeePerGas: 10n, maxPriorityFeePerGas: 100n, gasPrice: null }) as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas);
  });

  it('legacy gasPrice bila provider tidak memberi data EIP-1559; null bila tanpa data fee', () => {
    expect(bumpFees({ maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: 8n })).toEqual({ gasPrice: 10n });
    expect(bumpFees({ maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: null })).toBeNull();
  });
});

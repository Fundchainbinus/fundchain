import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { Contract, JsonRpcProvider, Wallet, id as keccakId } from 'ethers';
import { Api } from '../helpers/api';
import { REPO_ROOT } from '../helpers/env';
import { StepLog } from '../helpers/evidence';

/**
 * Gate 1 pre-flight checklist (BFD-5/66): migrasi, seed, health, kontrak ter-deploy di Hardhat lokal,
 * relayer memegang RELAYER_ROLE. Hasil per item → evidence-out/gate1-preflight.json.
 */
const log = new StepLog('gate1-preflight', [
  { id: 'P1', name: 'Migrasi Prisma terpasang (prisma migrate status)', expected: 'Database schema is up to date' },
  { id: 'P2', name: 'Seed terisi (persona demo + campaign contoh)', expected: 'login demo student/admin OK, >= 6 campaign seed' },
  { id: 'P3', name: 'Health API & proxy web', expected: 'GET /health = ok langsung dan lewat vite preview' },
  { id: 'P4', name: 'Konfigurasi fallback demo', expected: 'paymentProvider=mock, demoMode=true, chain localhost/31337' },
  { id: 'P5', name: 'DonationRegistry ter-deploy di Hardhat lokal', expected: 'bytecode ada di alamat contracts/deployments/localhost.json' },
  { id: 'P6', name: 'Relayer memegang RELAYER_ROLE', expected: 'hasRole(RELAYER_ROLE, relayer)=true, relayer != admin' },
]);

test.describe.configure({ mode: 'serial' });

test.afterAll(() => log.flush());

test('Gate 1 pre-flight checklist', async () => {
  const api = await Api.create('10.0.0.10');

  await log.run('P1', async () => {
    const r = spawnSync('pnpm', ['--filter', '@fundchain/api', 'exec', 'prisma', 'migrate', 'status'], {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.status, out).toBe(0);
    expect(out).toContain('Database schema is up to date');
    const applied = /(\d+) migrations? found/.exec(out)?.[1];
    return `exit 0, ${applied ?? '?'} migrasi ditemukan, "Database schema is up to date"`;
  });

  await log.run('P2', async () => {
    const student = await api.loginDemo('student');
    const admin = await api.loginDemo('admin');
    expect(student.user.email).toBe('budi.santoso@binus.ac.id');
    expect(admin.user.role).toBe('ADMIN');
    const all = await api.ok<{ campaigns: { title: string; status: string }[] }>('GET', '/admin/campaigns?status=ALL&limit=100', { token: admin.token });
    expect(all.campaigns.length).toBeGreaterThanOrEqual(6);
    const statuses = [...new Set(all.campaigns.map((c) => c.status))].sort();
    return `persona student=${student.user.email}, admin=${admin.user.email}; ${all.campaigns.length} campaign seed (status: ${statuses.join(', ')})`;
  });

  await log.run('P3', async () => {
    const direct = await api.ok<{ status: string }>('GET', '/health');
    expect(direct.status).toBe('ok');
    const res = await fetch(`${process.env.E2E_WEB_URL ?? 'http://localhost:5173'}/api/v1/health`);
    expect(res.status).toBe(200);
    const viaProxy = (await res.json()) as { data: { status: string } };
    expect(viaProxy.data.status).toBe('ok');
    return 'health ok (API :3000 dan proxy vite preview :5173)';
  });

  await log.run('P4', async () => {
    const cfg = await api.ok<{ paymentProvider: string; demoMode: boolean; devTools: boolean; googleClientId: string; chain: { network: string; chainId: number; contractAddress: string } }>('GET', '/config');
    expect(cfg.paymentProvider).toBe('mock');
    expect(cfg.demoMode).toBe(true);
    expect(cfg.devTools).toBe(true);
    expect(cfg.chain.network).toBe('localhost');
    expect(cfg.chain.chainId).toBe(31337);
    return `paymentProvider=${cfg.paymentProvider}, demoMode=${cfg.demoMode}, devTools=${cfg.devTools}, chain=${cfg.chain.network}/${cfg.chain.chainId}, contract=${cfg.chain.contractAddress}, googleClientId kosong=${cfg.googleClientId === ''}`;
  });

  const deployment = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contracts', 'deployments', 'localhost.json'), 'utf8')) as {
    address: string;
    admin: string;
    relayer: string;
    chainId: number;
  };
  const provider = new JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL ?? 'http://127.0.0.1:8545');

  await log.run('P5', async () => {
    const net = await provider.getNetwork();
    expect(Number(net.chainId)).toBe(31337);
    expect(deployment.chainId).toBe(31337);
    const code = await provider.getCode(deployment.address);
    expect(code.length).toBeGreaterThan(2);
    const cfg = await api.ok<{ chain: { contractAddress: string } }>('GET', '/config');
    expect(cfg.chain.contractAddress.toLowerCase()).toBe(deployment.address.toLowerCase());
    return `DonationRegistry ${deployment.address} (bytecode ${(code.length - 2) / 2} byte) di chain 31337; API memakai alamat yang sama`;
  });

  await log.run('P6', async () => {
    const relayer = new Wallet(process.env.RELAYER_PRIVATE_KEY!).address;
    expect(relayer.toLowerCase()).toBe(deployment.relayer.toLowerCase());
    expect(relayer.toLowerCase()).not.toBe(deployment.admin.toLowerCase());
    const registry = new Contract(deployment.address, ['function hasRole(bytes32,address) view returns (bool)'], provider);
    const role = keccakId('RELAYER_ROLE');
    expect(await registry.hasRole(role, relayer)).toBe(true);
    expect(await registry.hasRole(role, deployment.admin)).toBe(false);
    const balance = await provider.getBalance(relayer);
    return `relayer ${relayer} memegang RELAYER_ROLE; admin ${deployment.admin} tidak; saldo relayer ${balance} wei`;
  });

  await api.dispose();
});

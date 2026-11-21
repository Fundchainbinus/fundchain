import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './env';

export interface TamperJson {
  status: 'VERIFIED' | 'TAMPERED';
  currentHash: string;
  onChainHash: string;
  campaignFrozen: boolean;
}

export interface TamperRun {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json: TamperJson | null;
}

/**
 * Jalankan `demo:tamper` (BFD-53) persis seperti runbook: `ALLOW_DEMO_TAMPER=true pnpm --silent
 * --filter @fundchain/api demo:tamper <id> <nominal> [--json]`. DATABASE_URL diwarisi dari job CI
 * (service Postgres localhost) sehingga guard script mengizinkan; WORKER_ENABLED=false supaya konteks
 * Nest milik script tidak ikut memproses antrean notarisasi.
 */
export function runDemoTamper(donationId: string, amount: number, opts: { json?: boolean } = {}): TamperRun {
  const args = ['--silent', '--filter', '@fundchain/api', 'demo:tamper', donationId, String(amount)];
  if (opts.json) args.push('--json');
  const db = process.env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error('[e2e] DATABASE_URL bukan Postgres lokal; demo:tamper tidak dijalankan.');
  }
  const res = spawnSync('pnpm', args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ALLOW_DEMO_TAMPER: 'true', WORKER_ENABLED: 'false', NODE_ENV: 'development' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const stdout = res.stdout ?? '';
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.endsWith('}'))
    .pop();
  return {
    command: `ALLOW_DEMO_TAMPER=true pnpm ${args.join(' ')}`,
    exitCode: res.status,
    stdout,
    stderr: (res.stderr ?? '').slice(-4000),
    json: opts.json && jsonLine ? (JSON.parse(jsonLine) as TamperJson) : null,
  };
}

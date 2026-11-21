import { describe, expect, it } from 'vitest';
// Hanya fungsi pengaman yang diuji; main() tidak jalan saat di-import dan tidak ada koneksi DB.
import { demoTamperGuard } from '../scripts/demo-tamper';

const LOCAL = 'postgresql://postgres:postgres@localhost:5433/fundchain_bc_dev';
const DEMO_REMOTE = 'postgresql://postgres.demoref:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';

describe('demo:tamper guard (BFD-53/105)', () => {
  it('tanpa ALLOW_DEMO_TAMPER=true -> ditolak', () => {
    expect(demoTamperGuard({ DATABASE_URL: LOCAL })).toMatch(/ALLOW_DEMO_TAMPER=true/);
    expect(demoTamperGuard({ DATABASE_URL: LOCAL, ALLOW_DEMO_TAMPER: '1' })).toMatch(/ALLOW_DEMO_TAMPER=true/);
  });

  it('DB lokal + flag -> boleh', () => {
    expect(demoTamperGuard({ DATABASE_URL: LOCAL, ALLOW_DEMO_TAMPER: 'true' })).toBeNull();
    expect(demoTamperGuard({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/x', ALLOW_DEMO_TAMPER: 'TRUE' })).toBeNull();
  });

  it('NODE_ENV=production atau Vercel -> ditolak walau DB lokal', () => {
    expect(demoTamperGuard({ DATABASE_URL: LOCAL, ALLOW_DEMO_TAMPER: 'true', NODE_ENV: 'production' })).toMatch(/production/);
    expect(demoTamperGuard({ DATABASE_URL: LOCAL, ALLOW_DEMO_TAMPER: 'true', VERCEL: '1' })).toMatch(/production/);
  });

  it('DB remote tanpa allowlist -> ditolak, pesan tidak membocorkan password/URL', () => {
    const reason = demoTamperGuard({ DATABASE_URL: DEMO_REMOTE, ALLOW_DEMO_TAMPER: 'true' });
    expect(reason).toMatch(/remote/);
    expect(reason).not.toContain('secret');
    expect(reason).not.toContain('postgres.demoref');
  });

  it('DB remote hanya boleh bila DEMO_TAMPER_DB_ALLOW = "<user>@<host>" persis', () => {
    const host = 'aws-0-ap-southeast-1.pooler.supabase.com';
    expect(
      demoTamperGuard({ DATABASE_URL: DEMO_REMOTE, ALLOW_DEMO_TAMPER: 'true', DEMO_TAMPER_DB_ALLOW: `postgres.demoref@${host}` }),
    ).toBeNull();
    // Host pooler sama tapi project lain (mis. production) -> tetap ditolak.
    expect(
      demoTamperGuard({ DATABASE_URL: DEMO_REMOTE, ALLOW_DEMO_TAMPER: 'true', DEMO_TAMPER_DB_ALLOW: `postgres.prodref@${host}` }),
    ).not.toBeNull();
    expect(demoTamperGuard({ DATABASE_URL: DEMO_REMOTE, ALLOW_DEMO_TAMPER: 'true', DEMO_TAMPER_DB_ALLOW: host })).not.toBeNull();
  });

  it('DATABASE_URL kosong / bukan PostgreSQL -> ditolak', () => {
    expect(demoTamperGuard({ ALLOW_DEMO_TAMPER: 'true' })).toMatch(/DATABASE_URL/);
    expect(demoTamperGuard({ ALLOW_DEMO_TAMPER: 'true', DATABASE_URL: 'mysql://u:p@localhost/x' })).toMatch(/PostgreSQL/);
  });
});

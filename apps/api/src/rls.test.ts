/**
 * BFD-23 / D-003 — guard RLS deny-all.
 *
 * Aplikasi hanya mengakses DB lewat Prisma dengan role owner (bypass RLS); tidak ada akses PostgREST
 * dari browser. Semua tabel di schema public tetap terekspos ke Data API Supabase, jadi setiap tabel
 * WAJIB `ENABLE ROW LEVEL SECURITY` tanpa policy untuk anon/authenticated/public.
 *
 * Test ini membaca SEMUA file migrasi (bukan daftar tabel tetap), sehingga migrasi baru yang
 * menambah tabel tanpa RLS, atau menambah policy untuk role publik, langsung gagal di CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

/** Role yang bisa dipakai dari luar backend lewat Data API Supabase. */
const EXPOSED_ROLES = ['anon', 'authenticated', 'public'];

interface Migration {
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((name) => {
      try {
        return [{ name, sql: stripComments(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')) }];
      } catch {
        return [];
      }
    });
}

/** Buang komentar `-- ...` dan `/* ... *\/` supaya contoh di komentar tidak dihitung. */
export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** `"public"."users"`, `public.users`, `"users"`, `users` → `users`. */
function tableName(raw: string): string {
  const parts = raw.split('.').map((p) => p.trim().replace(/^"|"$/g, ''));
  return parts[parts.length - 1].toLowerCase();
}

const IDENT = String.raw`((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)`;

export function createdTables(sql: string): string[] {
  const re = new RegExp(String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}`, 'gi');
  return [...sql.matchAll(re)].map((m) => tableName(m[1]));
}

export function rlsEnabledTables(sql: string): string[] {
  const re = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENT}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`, 'gi');
  return [...sql.matchAll(re)].map((m) => tableName(m[1]));
}

export function rlsDisabledTables(sql: string): string[] {
  const re = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENT}\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY`, 'gi');
  return [...sql.matchAll(re)].map((m) => tableName(m[1]));
}

/**
 * Policy yang membuka akses ke role publik. `CREATE POLICY` tanpa klausa `TO` berlaku untuk PUBLIC
 * (default Postgres), jadi dianggap terbuka juga.
 */
export function exposedPolicies(sql: string): string[] {
  const out: string[] = [];
  for (const stmt of sql.split(';')) {
    if (!/^\s*CREATE\s+POLICY\b/i.test(stmt)) continue;
    const to = /\bTO\s+([\s\S]+?)(?:\bUSING\b|\bWITH\s+CHECK\b|$)/i.exec(stmt);
    const roles = to ? to[1].split(',').map((r) => r.trim().replace(/^"|"$/g, '').toLowerCase()) : ['public'];
    if (roles.some((r) => EXPOSED_ROLES.includes(r))) out.push(stmt.trim().replace(/\s+/g, ' '));
  }
  return out;
}

/** Status RLS akhir per tabel setelah semua migrasi dijalankan berurutan. */
function finalRlsState(migrations: Migration[]) {
  const created = new Set<string>();
  const enabled = new Set<string>();
  for (const m of migrations) {
    // Urutan dalam satu file: CREATE dulu, lalu ENABLE/DISABLE (cukup untuk pola migrasi Prisma).
    for (const t of createdTables(m.sql)) created.add(t);
    for (const t of rlsEnabledTables(m.sql)) enabled.add(t);
    for (const t of rlsDisabledTables(m.sql)) enabled.delete(t);
  }
  return { created, enabled };
}

describe('RLS deny-all (D-003)', () => {
  const migrations = loadMigrations();

  it('folder migrasi terbaca', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('setiap tabel yang dibuat di migrasi punya ENABLE ROW LEVEL SECURITY', () => {
    const { created, enabled } = finalRlsState(migrations);
    expect(created.size).toBeGreaterThan(0);
    const missing = [...created].filter((t) => !enabled.has(t));
    expect(missing, `Tabel tanpa RLS: tambahkan ALTER TABLE "<tabel>" ENABLE ROW LEVEL SECURITY di migrasinya`).toEqual([]);
  });

  it('tabel inti terdeteksi oleh parser', () => {
    const { created } = finalRlsState(migrations);
    for (const t of ['users', 'campaigns', 'donations', 'payments', 'disbursements', 'audit_logs', 'stored_files']) {
      expect(created.has(t)).toBe(true);
    }
  });

  it('_prisma_migrations juga ditutup dari Data API', () => {
    const { enabled } = finalRlsState(migrations);
    expect(enabled.has('_prisma_migrations')).toBe(true);
  });

  it('tidak ada CREATE POLICY untuk anon / authenticated / public', () => {
    const offenders = migrations.flatMap((m) => exposedPolicies(m.sql).map((p) => `${m.name}: ${p}`));
    expect(offenders).toEqual([]);
  });
});

describe('parser RLS (sanity)', () => {
  it('membaca nama tabel dengan schema, quote, dan IF NOT EXISTS', () => {
    const sql = `CREATE TABLE IF NOT EXISTS "public"."foo" (id int); create table bar (id int); CREATE TABLE public.baz ();`;
    expect(createdTables(sql)).toEqual(['foo', 'bar', 'baz']);
    expect(rlsEnabledTables(`ALTER TABLE ONLY "public"."foo" ENABLE ROW LEVEL SECURITY;`)).toEqual(['foo']);
  });

  it('mengabaikan komentar', () => {
    expect(createdTables(stripComments(`-- CREATE TABLE "ghost" ();\n/* CREATE TABLE x (); */`))).toEqual([]);
  });

  it('policy tanpa TO dianggap PUBLIC; policy untuk role service tidak', () => {
    expect(exposedPolicies(`CREATE POLICY p ON "users" FOR SELECT USING (true);`)).toHaveLength(1);
    expect(exposedPolicies(`CREATE POLICY p ON "users" FOR SELECT TO anon USING (true);`)).toHaveLength(1);
    expect(exposedPolicies(`CREATE POLICY p ON "users" TO "authenticated", service_role USING (true);`)).toHaveLength(1);
    expect(exposedPolicies(`CREATE POLICY p ON "users" FOR ALL TO service_role USING (true);`)).toHaveLength(0);
  });
});

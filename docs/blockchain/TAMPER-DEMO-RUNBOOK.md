# Runbook: Gate 2 & Demo "Data Tampering & Auto-Freeze"

Panduan untuk QA Gate 2 dan gladi bersih Demo Day. Skenario yang dibuktikan:
**data donasi diubah di database → hash checker mendeteksi → donasi TAMPERED → campaign FROZEN → pencairan terkunci.**

## Komponen yang terlibat

| Komponen | Lokasi | Fungsi |
| --- | --- | --- |
| Hash checker otomatis | `IntegrityService.verifyStale()` dipanggil `NotarizationWorker.tick()` | Cek ulang donasi yang terakhir dicek > `INTEGRITY_CHECK_INTERVAL_MS` (default 1 jam), maks `INTEGRITY_CHECK_BATCH` per putaran |
| Cek manual | `POST /api/v1/admin/donations/:id/verify`, `/admin/campaigns/:id/verify`, `/admin/integrity/verify-all` | Admin → Integritas |
| Tamper tracing | Audit log `INTEGRITY_TAMPERED` | Mencatat sumber deteksi, hash DB/on-chain, data saat ini, IP & User-Agent |
| Auto-freeze | `CampaignsService.freeze()` | Campaign → FROZEN, `frozenAt` dicatat, pencairan terkunci |
| Soft-delete | `CampaignsService.softDeleteFrozen()` | FROZEN > `FROZEN_SOFT_DELETE_DAYS` (default 30) disembunyikan dari publik & pemilik; admin tetap bisa melihat |
| Proof API | `GET /api/v1/donations/:id/proof` | Data halaman "Bukti Donasi" |
| Script demo | `pnpm --filter @fundchain/api demo:tamper` | Simulasi orang dalam mengubah nominal di DB (wajib `ALLOW_DEMO_TAMPER=true`, menolak DB production) |

> Di Vercel, cron hanya jalan sekali sehari (`/api/v1/cron/tick`); selain itu checker ikut berjalan setiap kali worker dipicu request. Di server biasa (`WORKER_MODE=interval`) checker jalan tiap menit untuk donasi yang sudah melewati interval.

## Pengaman script (BFD-53/105)

`demo:tamper` mengubah data donasi langsung di database, jadi script menolak jalan (exit 1, tanpa query apa pun) kecuali:

1. `ALLOW_DEMO_TAMPER=true` di-set **di shell** (nilai di `apps/api/.env` diabaikan, supaya `.env` tidak mengizinkan dirinya sendiri).
2. Bukan production: `NODE_ENV` bukan `production` dan `VERCEL` kosong.
3. `DATABASE_URL` menunjuk host lokal (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`), **atau** database demo remote yang di-allowlist persis lewat `DEMO_TAMPER_DB_ALLOW="<user>@<host>"` (di shell).
   Pooler Supabase dipakai bersama banyak project dan project dibedakan oleh username `postgres.<PROJECT_REF>`, jadi host saja tidak cukup. Jangan pernah mengisi allowlist dengan user/host database production.

Pesan penolakan tidak pernah mencetak URL atau password database.

Contoh perintah di dokumen ini memakai sintaks bash/Git Bash (`VAR=nilai perintah`). Di PowerShell, set variabel lebih dulu:

```powershell
$env:ALLOW_DEMO_TAMPER = 'true'
$env:DATABASE_URL = '<URL database demo>'   # override .env; jangan URL production
pnpm --filter @fundchain/api demo:tamper <donationId> 900000 --check
Remove-Item Env:ALLOW_DEMO_TAMPER            # matikan lagi setelah demo
```

> PERINGATAN: `apps/api/.env` lokal bisa menunjuk database **production**. Untuk demo, override `DATABASE_URL` di shell ke database demo (mis. stack `bc-local`: `postgresql://...@127.0.0.1:5433/fundchain_bc_dev`).

## Persiapan (H-1)

1. Pakai **database & chain khusus demo** — jangan database production/bersama.
2. Jalankan migration terbaru: `pnpm --filter @fundchain/api prisma migrate deploy`.
3. Pastikan ada minimal satu donasi **PAID** yang notarisasinya **CONFIRMED** (cek di halaman Bukti Donasi atau `GET /donations/:id/proof` → `hashOnChain` terisi, `match: true`).
4. Catat ID donasi dan nominal aslinya.
5. Untuk demo, set `INTEGRITY_CHECK_INTERVAL_MS=60000` supaya checker otomatis menangkap tamper dalam ±1 menit.

## Skenario Gate 2 / Demo

1. Buka halaman campaign & Bukti Donasi → status **VERIFIED**, hash DB = hash on-chain.
2. Jalankan simulasi tamper:
   ```bash
   ALLOW_DEMO_TAMPER=true pnpm --filter @fundchain/api demo:tamper <donationId> 900000 --check
   ```
   Output yang diharapkan: `Status donasi: TAMPERED`, `Status campaign: FROZEN`.
   Tanpa `--check`, tunggu hash checker otomatis (±1 menit dengan setting demo) atau klik verifikasi di Admin → Integritas.
3. Tunjukkan buktinya:
   - Halaman campaign: banner FROZEN.
   - `GET /donations/:id/proof` → `match: false`, `currentHash` ≠ `hashOnChain`.
   - Ajukan pencairan → ditolak dengan `CAMPAIGN_FROZEN`.
   - Admin → Audit log: `INTEGRITY_TAMPERED` (sumber, hash, data saat ini, IP, User-Agent) dan `CAMPAIGN_FROZEN`.
4. Tunjukkan unfreeze ditolak selama data belum pulih (`CAMPAIGN_FROZEN`: "Masih ada N donasi TAMPERED").

### Output JSON (untuk skrip / bukti QA)

`--json` menjalankan integrity check (otomatis `--check`) dan mencetak **satu baris JSON** ke stdout:

```bash
ALLOW_DEMO_TAMPER=true pnpm --silent --filter @fundchain/api demo:tamper <donationId> 900000 --json
```

```json
{"status":"TAMPERED","currentHash":"0x…","onChainHash":"0x…","campaignFrozen":true}
```

| Field | Arti |
| --- | --- |
| `status` | `VERIFIED` (hash DB sekarang = hash on-chain) atau `TAMPERED` |
| `currentHash` | Hash yang dihitung ulang dari data DB saat ini |
| `onChainHash` | Hash yang tercatat di contract `DonationRegistry` |
| `campaignFrozen` | `true` bila campaign berstatus `FROZEN` setelah pengecekan |

- Pesan manusia (nominal lama → baru, perintah pulihkan) dikirim ke **stderr**, log Nest dimatikan; stdout hanya JSON. Pakai `pnpm --silent` supaya banner pnpm tidak ikut tercetak.
- Contoh di CI/QA: `... --json | jq -e '.status == "TAMPERED" and .campaignFrozen'`.
- Exit code 1 bila pengaman menolak atau terjadi error (pesan di stderr, tanpa JSON).

## Reset setelah demo

```bash
ALLOW_DEMO_TAMPER=true pnpm --filter @fundchain/api demo:tamper <donationId> <nominalAsli> --check
```
Status donasi kembali **VERIFIED**, lalu unfreeze campaign dari Admin (wajib isi alasan).

## Checklist lulus Gate 2

Bukti otomatis: [`docs/qa/GATE-2.md`](../qa/GATE-2.md), run CI [#44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635) (stack lokal, `e2e/specs/02-gate2-tamper.spec.ts`).

- [x] Tamper terdeteksi oleh checker otomatis tanpa klik admin (G2-09: `source=SCHEDULED`, FROZEN ±70 dtk dengan `INTEGRITY_CHECK_INTERVAL_MS=15000`)
- [x] Campaign otomatis FROZEN, pencairan & approve pencairan terkunci (G2-03, G2-04: `409 CAMPAIGN_FROZEN`)
- [x] Audit log `INTEGRITY_TAMPERED` berisi sumber, hash, IP, User-Agent (G2-05; IP/UA terisi pada pengecekan manual admin, kosong untuk sumber script/worker)
- [x] Proof API menunjukkan `match: false` (G2-03)
- [x] Unfreeze ditolak sebelum data dipulihkan; berhasil setelah verifikasi ulang VERIFIED (G2-07, G2-08)
- [x] Unit test: `pnpm --filter @fundchain/api test` (skenario ada di `src/integrity.test.ts`) (322/322 lulus di run yang sama)
- [ ] Tidak ada bug S1/S2 terkait integritas data (tidak ada temuan di run otomatis; menunggu sign-off QA + TL)

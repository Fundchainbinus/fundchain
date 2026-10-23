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
| Script demo | `pnpm --filter @fundchain/api demo:tamper` | Simulasi orang dalam mengubah nominal di DB |

> Di Vercel, cron hanya jalan sekali sehari (`/api/v1/cron/tick`); selain itu checker ikut berjalan setiap kali worker dipicu request. Di server biasa (`WORKER_MODE=interval`) checker jalan tiap menit untuk donasi yang sudah melewati interval.

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
   pnpm --filter @fundchain/api demo:tamper <donationId> 900000 --check
   ```
   Output yang diharapkan: `Status donasi: TAMPERED`, `Status campaign: FROZEN`.
   Tanpa `--check`, tunggu hash checker otomatis (±1 menit dengan setting demo) atau klik verifikasi di Admin → Integritas.
3. Tunjukkan buktinya:
   - Halaman campaign: banner FROZEN.
   - `GET /donations/:id/proof` → `match: false`, `currentHash` ≠ `hashOnChain`.
   - Ajukan pencairan → ditolak dengan `CAMPAIGN_FROZEN`.
   - Admin → Audit log: `INTEGRITY_TAMPERED` (sumber, hash, data saat ini, IP, User-Agent) dan `CAMPAIGN_FROZEN`.
4. Tunjukkan unfreeze ditolak selama data belum pulih (`CAMPAIGN_FROZEN`: "Masih ada N donasi TAMPERED").

## Reset setelah demo

```bash
pnpm --filter @fundchain/api demo:tamper <donationId> <nominalAsli> --check
```
Status donasi kembali **VERIFIED**, lalu unfreeze campaign dari Admin (wajib isi alasan).

## Checklist lulus Gate 2

- [ ] Tamper terdeteksi oleh checker otomatis tanpa klik admin
- [ ] Campaign otomatis FROZEN, pencairan & approve pencairan terkunci
- [ ] Audit log `INTEGRITY_TAMPERED` berisi sumber, hash, IP, User-Agent
- [ ] Proof API menunjukkan `match: false`
- [ ] Unfreeze ditolak sebelum data dipulihkan; berhasil setelah verifikasi ulang VERIFIED
- [ ] Unit test: `pnpm --filter @fundchain/api test` (skenario ada di `src/integrity.test.ts`)
- [ ] Tidak ada bug S1/S2 terkait integritas data

# Runbook: pemicu cron tick (Supabase pg_cron)

Keputusan: [D-017](../DECISIONS.md#d-017--pemicu-cron-tick-supabase-pg_cron--pg_net-bfd-128-issue-34). Tugas asal:
[`docs/tasks/EXTERNAL-SCHEDULER.md`](../tasks/EXTERNAL-SCHEDULER.md) (BFD-127, BFD-128, issue #34).

## Cara kerja

```
pg_cron (tiap 5 menit) ── fundchain_ops.cron_tick() ── pg_net GET /api/v1/cron/tick ──▶ NotarizationWorker.tick('cron')
                                                     Authorization: Bearer <Vault: fundchain_cron_secret>
pg_cron (tiap 10 menit) ─ fundchain_ops.tick_watchdog() ─ system_state.last_tick_at > 30 menit? ─▶ Discord (Vault: fundchain_alert_webhook_url)
```

- **Lease lintas instance (BFD-127).** Setiap tick mengambil lease di `system_state` (`key = 'cron_tick'`, 55 detik)
  lewat UPDATE bersyarat. Tick dari pg_cron, GitHub Actions, Vercel Cron harian, dan `kick()` setelah pembayaran tidak
  pernah berjalan bersamaan; yang kalah melewatkan putarannya dan mengembalikan `ran: false`. Lihat
  `apps/api/src/modules/blockchain/tick-lease.ts`.
- **Jejak tick (BFD-128).** Akhir setiap tick menyimpan `last_tick_at`, `last_tick_ms`, durasi per langkah
  (`last_tick_steps`), `last_tick_ok`, dan sumber. Ditampilkan di `GET /api/v1/health` (`tick`) dan kartu
  **Cron tick** di dashboard admin (merah bila > 30 menit).
- **Cadangan.** `cron-tick.yml` (GitHub, tidak tepat waktu) dan Vercel Cron harian tetap aktif. Aman karena lease.

## Pemasangan (sekali)

0. **Secret ke Vault — dikerjakan pemilik akun, jangan di-commit / ditempel ke chat.** Supabase → SQL Editor:

   ```sql
   select vault.create_secret('<nilai CRON_SECRET di Vercel>', 'fundchain_cron_secret');
   -- opsional tapi dianjurkan (alarm tick berhenti):
   select vault.create_secret('<URL webhook Discord>', 'fundchain_alert_webhook_url');
   ```

   Ganti nilai di kemudian hari: `select vault.update_secret((select id from vault.secrets where name = 'fundchain_cron_secret'), '<nilai baru>');`

1. Jalankan `apps/api/supabase/cron-scheduler.sql` di SQL Editor (idempoten).
2. Pastikan migrasi `20261127000100_system_state` sudah diterapkan (`pnpm --filter @fundchain/api db:deploy`).

## Rotasi `CRON_SECRET`

Urutan supaya tidak ada tick yang ditolak lama:

1. Buat nilai baru (`[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))` di PowerShell).
2. Ubah `CRON_SECRET` di Vercel (project `fundchain-api`, Production) → redeploy.
3. Segera ubah secret Vault (`vault.update_secret`, lihat di atas) dan secret repo GitHub `CRON_SECRET`.
4. Cek `net._http_response`: status 200 lagi dalam ≤ 5 menit. Selama jeda langkah 2–3 tick menghasilkan 401; itu
   wajar, watchdog baru berbunyi setelah 30 menit.

## Pemeriksaan

```sql
select jobname, schedule, active from cron.job where jobname like 'fundchain-%';
select status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
select status_code, created, error_msg from net._http_response order by created desc limit 20;
select last_tick_at, last_tick_ms, last_tick_source, last_tick_ok, last_tick_steps from public.system_state;
```

Atau tanpa akses DB: `curl https://fundchain-api.vercel.app/api/v1/health` → `tick.stale` harus `false`.

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| `net._http_response.status_code = 401` | Secret Vault ≠ `CRON_SECRET` Vercel | Samakan (rotasi langkah 3) |
| `return_message` berisi `belum ada di Vault` | Langkah 0 belum dikerjakan | Isi secret |
| `status_code` kosong + `error_msg` timeout | API lambat / Vercel down | Cek log Vercel; `last_tick_steps` menunjukkan langkah yang lambat |
| Tidak ada baris baru di `cron.job_run_details` | Project Supabase di-pause (paket gratis, 7 hari tanpa aktivitas) atau job `active = false` | Restore project; `select cron.alter_job(jobid, active := true)` |
| Watchdog diam padahal tick berhenti | `fundchain_alert_webhook_url` belum diisi | Isi secret; warning tetap tercatat di `cron.job_run_details` |

## Uji alarm

1. `select cron.alter_job((select jobid from cron.job where jobname = 'fundchain-cron-tick'), active := false);`
2. Tunggu > 30 menit tanpa transaksi (kick dari request juga menyegarkan `last_tick_at`), lalu tunggu watchdog
   (≤ 10 menit). Pesan "cron tick berhenti" harus masuk Discord.
3. Nyalakan lagi: `... active := true`. Hasil uji dicatat di D-017.

## Mematikan / pindah scheduler

```sql
select cron.unschedule('fundchain-cron-tick');
select cron.unschedule('fundchain-tick-watchdog');
```

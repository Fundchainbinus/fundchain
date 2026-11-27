# Tugas backend: pemicu cron yang bisa diandalkan (issue #34, D-015)

**Pemilik:** tim backend · **Perkiraan:** 2–4 hari kerja termasuk riset, implementasi, dan uji · **Prioritas:**
wajib sebelum FundChain menerima donasi publik. Untuk proyek kelas, D-015 menerima kondisi sekarang.

## Masalah

`GET /api/v1/cron/tick` harus dipanggil rutin (target: tiap 5–10 menit). Saat ini pemicunya GitHub Actions
`cron-tick.yml`, yang kenyataannya hanya jalan tiap 5–11 jam. Vercel Cron di paket Hobby hanya harian.
Dampaknya ada di tabel D-015 (`docs/DECISIONS.md`).

Yang dikerjakan satu tick (`NotarizationWorker.tick()`): expire donasi PENDING, antrean notarisasi, campaign lewat
deadline, soft-delete campaign FROZEN, integrity checker, dan alert antrean macet.

## Pilihan yang harus dibandingkan

Tim **memilih satu** dan menuliskan alasannya sebagai keputusan baru di `docs/DECISIONS.md` (D-016).

| Opsi | Kelebihan | Kekurangan / risiko |
|---|---|---|
| **cron-job.org** (atau EasyCron) memanggil endpoint dengan header `Authorization` | Gratis, setup 10 menit, ada riwayat & notifikasi gagal | Vendor pihak ketiga memegang `CRON_SECRET`; akun milik siapa (bus factor tim mahasiswa); batas waktu request ±30 dtk, padahal function boleh 60 dtk |
| **Upstash QStash** (schedule) | Request ditandatangani (bisa diverifikasi, tidak perlu secret statis), retry otomatis, gratis untuk volume kecil | Perlu kode verifikasi signature di endpoint; vendor & akun baru |
| **Supabase `pg_cron` + `pg_net`** | Tidak ada vendor baru (DB sudah di Supabase); jadwal tersimpan di database | Secret tersimpan di DB; kegagalan HTTP kurang terlihat; harus dipastikan ekstensi tersedia di project; jadwal ikut ter-restore bersama backup |
| **Cloudflare Workers Cron Triggers** | Gratis, presisi, kode pemanggil di-version-control | Akun & deployment terpisah; secret disimpan di Cloudflare |
| **Vercel Pro** (Cron per menit) | Paling sederhana, satu platform | Berbayar (±US$20/bulan per anggota); butuh pemilik akun Vercel |

Pertanyaan yang harus dijawab di D-016: siapa pemilik akun/secret, apa yang terjadi bila pemilik akun lulus/keluar,
bagaimana tim tahu kalau scheduler berhenti, dan berapa biaya bila volume naik.

## Hal teknis yang wajib ditangani (bukan sekadar "pasang scheduler")

1. **Tick yang tumpang-tindih.** Guard sekarang `this.running` hanya di memori satu instance. Di Vercel, dua panggilan
   bisa jalan di dua instance berbeda bersamaan (scheduler retry, atau tick lambat + tick berikutnya). Buktikan setiap
   bagian tick aman dijalankan paralel, atau tambahkan kunci lintas instance (mis. `pg_try_advisory_lock`) beserta test.
   Petunjuk: klaim notarisasi sudah memakai `updateMany` bersyarat; periksa `expireStale`, `completeExpired`,
   `softDeleteFrozen`, dan integrity checker satu per satu.
2. **Batas waktu.** Tick harus selesai jauh di bawah 60 dtk (`maxDuration`) dan di bawah timeout scheduler yang dipilih.
   Ukur durasi tick di production (log durasi per langkah) dan tentukan batas per langkah bila perlu.
3. **Autentikasi.** Bila memakai secret statis: rotasi `CRON_SECRET` saat pindah, simpan hanya di Vercel + scheduler,
   jangan di repo. Bila memakai request bertanda tangan (QStash): verifikasi signature dan tolak request lama (replay).
4. **Monitoring.** Harus ada alarm bila tick tidak jalan > 30 menit. Opsi: catat `lastTickAt` dan tampilkan di dashboard
   admin, atau kirim alert ke `ALERT_WEBHOOK_URL` (lihat issue/BFD-115) dari job terpisah.
5. **Matikan pemicu lama dengan sengaja.** Putuskan apakah `cron-tick.yml` dihapus, diganti `workflow_dispatch` saja,
   atau tetap sebagai cadangan (aman bila poin 1 beres). Vercel Cron harian tetap sebagai cadangan.

## Kriteria selesai

- [ ] D-016 di `docs/DECISIONS.md`: opsi terpilih, alasan, pemilik akun, biaya, rencana bila pemilik keluar.
- [ ] Scheduler aktif di production; riwayat menunjukkan ≥ 24 jam tick berjalan dengan jarak ≤ 10 menit.
- [ ] Test unit/integrasi untuk tick paralel (poin 1) dan, bila relevan, verifikasi signature (poin 3).
- [ ] Log durasi tick tersedia; durasi p95 dicatat di D-016.
- [ ] Alarm tick berhenti sudah diuji (matikan scheduler 30+ menit, pastikan alert muncul).
- [ ] `README.md` dan D-015 diperbarui; catatan PENTING cron di README dihapus.
- [ ] Issue #34 ditutup dengan tautan ke PR.

## Bacaan

- `apps/api/src/modules/integrity/integrity.controller.ts` — endpoint `cron/tick` dan cek secret.
- `apps/api/src/modules/blockchain/notarization.worker.ts` — `tick()`, `housekeeping()`, klaim antrean.
- `docs/blockchain/WORKER.md`, `docs/DECISIONS.md` D-005 dan D-015, `.github/workflows/cron-tick.yml`.

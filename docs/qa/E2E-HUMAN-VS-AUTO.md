# Peta E2E: langkah otomatis vs butuh manusia

> Disusun 26 Nov 2026 untuk QA. Dasar: kode di `main` (termasuk D-010 s.d. D-013) dan spesifikasi E2E di `e2e/specs/`.
> **Otomatis** = sistem menjalankan sendiri tanpa klik/keputusan siapa pun. **Manusia** = perlu orang
> (klik, keputusan, transfer uang, atau konfigurasi). **Pemicu** = otomatis, tapi harus ada yang memicu jadwalnya.

## Ringkasan

| | Jumlah langkah |
| --- | --- |
| Otomatis penuh | 12 |
| Otomatis, butuh pemicu jadwal (cron) | 5 |
| Butuh manusia | 16 |

Titik paling rawan untuk demo: **pemicu cron** (GitHub Actions jalan tiap 5–11 jam, bukan 10 menit; BFD-113).
Jalankan *Cron tick* manual (Actions → Cron tick → Run workflow) sebelum langkah yang bergantung padanya.

## 1. Campaign

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| C1 | Login Google | Manusia | Mahasiswa klik login. Role ADMIN otomatis dari `ADMIN_EMAILS` | `01-gate1` (persona), manual sekali dengan akun asli |
| C2 | Isi form campaign | Manusia | Judul, deskripsi, SDG, target, deadline | `01-gate1` |
| C3 | Validasi deskripsi asal ketik | Otomatis | `gibberishProblem`: kata >30 huruf, pola berulang, <8 kata, nyaris tanpa vokal | unit `text-quality.test.ts`; manual: ketik "hasjdhjshd…" → ditolak |
| C4 | Unggah proposal PDF | Manusia | Magic bytes PDF dicek otomatis | `04-security` (magic bytes) |
| C5 | Submit review | Manusia | Deskripsi dicek ulang otomatis | `01-gate1` |
| C6 | **Review admin (approve/reject)** | **Manusia** | Keputusan admin, alasan wajib saat reject | `01-gate1` |
| C7 | Campaign tampil publik | Otomatis | Status ACTIVE | `01-gate1` |
| C8 | Campaign lewat deadline → COMPLETED | Pemicu | Dijalankan `cron/tick` | Manual: set deadline dekat, jalankan Cron tick |
| C9 | Perbaiki konten lama yang asal ketik | Manusia | `pnpm --filter @fundchain/api campaign:fix-content` (laporan), `--campaign <id> --apply` | Manual di DB staging |

## 2. Donasi & pembayaran

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| D1 | Donatur pilih nominal & bayar | Manusia | Membuat QRIS lewat gateway | `01-gate1` |
| D2 | Pembuatan QRIS | Otomatis | `mock` atau `sakurupiah` (D-011) | unit `sakurupiah.test.ts`; **sandbox Sakurupiah belum diuji** |
| D3 | **Scan & bayar QRIS** | **Manusia** | Di aplikasi bank/e-wallet. Mode mock: tombol "Simulasi Bayar" | Mock: `01-gate1`. Sakurupiah: manual di sandbox (BFD-111) |
| D4 | Webhook → donasi PAID + hash | Otomatis | Signature diverifikasi; nominal dicek ke DB | unit `payments-flow.test.ts`, `sakurupiah.test.ts` |
| D5 | Fallback bila webhook hilang | Pemicu | Polling status ke gateway saat tick | unit `payments.test.ts` |
| D6 | Pembayaran kedaluwarsa (15 menit) | Pemicu | Ditandai EXPIRED saat tick | Manual: buat donasi, tunggu 15 menit, jalankan Cron tick |
| D7 | Poin comserve | Otomatis | 1 poin / Rp10.000 donasi PAID | unit `core.test.ts` |

## 3. Blockchain & integritas

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| B1 | Notarisasi hash ke chain | Otomatis* | Worker; di Vercel berjalan saat request/cron (`waitUntil`) | `02-gate2-tamper`, unit `notarization.worker.test.ts` |
| B2 | Retry 5x saat gagal | Otomatis | Backoff 2/4/8/16 detik, lalu FAILED | unit `blockchain-retry.test.ts` |
| B3 | **Isi saldo relayer** | **Manusia** | Sepolia: kirim ETH testnet saat alert saldo rendah. Binusian (gas 0): tidak perlu | Workflow *Relayer balance* |
| B4 | Cek integritas berkala | Pemicu | Sweep tiap tick; admin juga bisa "Verifikasi semua" | `02-gate2-tamper` |
| B5 | Data diubah → TAMPERED → campaign FROZEN | Otomatis | Pencairan terkunci | `02-gate2-tamper`, `05-dry-run` |
| B6 | **Unfreeze campaign** | **Manusia** | Admin, setelah klarifikasi | `03-refund-milestone` |
| B7 | FROZEN >30 hari → disembunyikan | Pemicu | Soft-delete otomatis | unit |
| B8 | Bukti lama setelah pindah jaringan | Otomatis | Dibaca dari chain asal (D-013) | unit `chain-origin.test.ts` |
| B9 | **Bangun & operasikan jaringan Binusian** | **Manusia** | Server, validator, VPN RPC, deploy contract (`infra/binusian-chain/README.md`) | Belum bisa diuji: jaringan belum ada |

## 4. Pencairan dana

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| P1 | Ajukan tahap pencairan + bukti | Manusia | Mahasiswa unggah bukti/rencana | `03-refund-milestone` |
| P2 | Nominal tahap 20/40/60/80/100% | Otomatis | Dihitung backend (D-010); satu tahap terbuka dalam satu waktu | unit `core.test.ts`; `03-refund-milestone` M-05 |
| P3 | **Approve / reject pengajuan** | **Manusia** | Admin memeriksa bukti | `03-refund-milestone` |
| P4 | **Transfer dana ke pembuat campaign** | **Manusia** | Di luar sistem (bank) | Tidak bisa diotomasi |
| P5 | **Tandai sudah dibayar** | **Manusia** | Admin "Mark paid" | `03-refund-milestone` |

## 5. Refund

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| R1 | **Refund donasi di campaign FROZEN** | **Manusia** | Admin mencatat dengan alasan (D-001); hanya campaign FROZEN | `03-refund-milestone` |
| R2 | **Kembalikan uang ke donatur** | **Manusia** | Transfer manual; gateway tidak punya API refund | Tidak bisa diotomasi |

## 6. Mitra CSR (D-012)

| # | Langkah | Siapa | Detail | Cara QA menguji |
| --- | --- | --- | --- | --- |
| S1 | **MoU dengan perusahaan** | **Manusia** | BizDev (BFD-102) | — |
| S2 | **Daftarkan mitra** | **Manusia** | Admin → Mitra CSR | unit `csr.test.ts`; **belum ada spec E2E** |
| S3 | **Perusahaan transfer dana** | **Manusia** | Ke rekening resmi | — |
| S4 | **Catat kontribusi + nomor referensi** | **Manusia** | Admin; referensi ganda ditolak | unit `csr.test.ts` |
| S5 | Kontribusi → PAID + hash + notarisasi | Otomatis | Jalur settlement yang sama dengan QRIS | unit `csr.test.ts` + B1 |
| S6 | Tampil di `/csr` & halaman campaign | Otomatis | | Manual |

## 7. Operasional

| # | Langkah | Siapa | Detail |
| --- | --- | --- | --- |
| O1 | Backup DB harian | Pemicu | Workflow *DB backup* (terenkripsi). Uji restore: manusia, berkala |
| O2 | Alert operasional | Otomatis | Perlu `ALERT_WEBHOOK_URL` diisi manusia (BFD-115) |
| O3 | Konfigurasi env production | Manusia | Vercel env: Sakurupiah (`SAKURUPIAH_*`), jaringan (`BLOCKCHAIN_*`) |

## Celah pengujian yang perlu ditutup

1. Sakurupiah sandbox end-to-end (D3/D4) — butuh akun merchant (BFD-107, BFD-111).
2. Spec E2E untuk CSR (S2–S6) dan untuk tahap 3–5 pencairan.
3. Migrasi `20261126000000_csr_companies` belum dijalankan ke Postgres sungguhan (Docker tidak aktif saat dibuat);
   jalankan `prisma migrate deploy` di DB staging dulu.
4. Jaringan Binusian (B9) belum ada; uji cut-over di staging sebelum production. Sebelum pindah, pastikan antrean
   notarisasi Sepolia kosong (worker hanya memproses antrean chain aktif).

# Security Test (BFD-69)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:58 UTC (22 Nov 2026 00:58 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f` |
| Artifact (30 hari) | `e2e-evidence`, `e2e-stack-logs` (`gitleaks.log`) |
| Spec | [`e2e/specs/04-security.spec.ts`](../../e2e/specs/04-security.spec.ts) |
| Hasil | **PASS**: 13/13, tidak ada temuan kerentanan |

## Environment

Sama dengan [GATE-1](GATE-1.md#environment). Uji dilakukan di level API, langsung ke `127.0.0.1:3000/api/v1`. Setiap request memakai konteks HTTP baru, jadi tidak ada cookie yang terbawa dari request sebelumnya. Klien uji membedakan diri lewat header `X-Forwarded-For`, yang dipercaya API dari proxy loopback di non-production, sehingga bucket rate limit antar-spec terpisah.

## Hasil

| # | Uji | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| S-01 | IDOR baca (Budi → data user lain) | 403/404 | Donasi PENDING milik admin `404`; campaign PENDING_REVIEW Andi `404`; campaign REJECTED Siti `404`; link proposal Andi `403`; activity `404`. Pembanding: admin `200` | PASS |
| S-02 | IDOR tulis | 403, data tidak berubah | PATCH/submit/DELETE campaign Siti `403 CAMPAIGN_NOT_OWNED`; ajukan pencairan di campaign Siti `403`; simulasi bayar donasi admin `403`. Campaign tetap REJECTED, donasi tetap PENDING | PASS |
| S-03 | Tanpa login ke endpoint privat | 401 | `/auth/me`, `/me/donations`, `/me/points`, `POST /campaigns`, `/admin/stats`: `401` | PASS |
| S-04 | Non-admin ke endpoint admin | 403 | 10 endpoint (stats, audit-logs, donations, campaigns, disbursements, approve, freeze, verify-all, refund, retry blockchain): semua `403 AUTH_FORBIDDEN`; status campaign tidak berubah | PASS |
| S-05 | Webhook palsu | 401 | Secret salah, tanpa signature, signature ngawur, dan signature dari body lain: `401 PAYMENT_SIGNATURE_INVALID` | PASS |
| S-06 | Webhook dobel | 200 replayed | Pertama `200 replayed=false`, kedua dan ketiga `200 replayed=true`, saldo tidak berubah; mismatch `400`; order tak dikenal `404` | PASS |
| S-07 | Rate limit | 429 | `/auth/demo`: 10×200 lalu 429, 429. `/auth/google`: 10×401 lalu 429, 429 (`RATE_LIMITED`). IP lain tetap `200` | PASS |
| S-08 | CSRF (POST via cookie) | 403 tanpa `X-Requested-With: fundchain` | Tanpa header `403`; header salah `403`; GET via cookie `200`; dengan header benar `201` | PASS |
| S-09 | Payload bergaya SQL injection | Tidak ada 500, tidak bocor | 54 probe (`q`, `sdg`, `status`, `cursor`, `limit`, filter audit-log, filter admin donations, path id): 31×200, 23×400, **0×5xx**. Tidak ada stack trace/Prisma/PII; tidak ada campaign non-publik di respons publik; tabel utuh | PASS |
| S-10 | Upload file berbahaya | 400 | Teks/HTML yang diberi nama `.pdf` dan file `.exe`: `400 INVALID_FILE_TYPE` (cek magic bytes) | PASS |
| S-11 | Cookie & error | HttpOnly, SameSite, tanpa stack | `HttpOnly; SameSite=Lax; Path=/api; Max-Age=604800`; error 404/400 tanpa stack trace; tanpa `X-Powered-By` | PASS |
| S-12 | Secret tidak di-commit | Tidak ada `.env` asli di git | Satu-satunya file `.env*` yang dilacak adalah `apps/web/.env.remote` (URL publik, sengaja di-whitelist `.gitignore`). gitleaks: "no leaks found" | PASS |
| S-13 | Revokasi sesi | Token lama 401 setelah logout | Sebelum logout `200`; `POST /auth/logout` `200`; cookie lama, Bearer lama, dan sesi lain user yang sama: `401` | PASS |

Bukti: [`evidence/bfd69-security.json`](evidence/bfd69-security.json), [`evidence/bfd69-security-results.json`](evidence/bfd69-security-results.json), [`evidence/bfd69-sqli-probes.json`](evidence/bfd69-sqli-probes.json), [`evidence/gitleaks.log`](evidence/gitleaks.log)

## Secret scanning

- Job **Secret scan (gitleaks)** di [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) memindai seluruh riwayat git (`fetch-depth: 0`) di setiap push/PR ke `main`.
- Workflow `e2e-gates.yml` menjalankan perintah gitleaks yang sama. Checkout di sana dangkal, jadi hanya 1 commit yang terpindai; scan riwayat penuh tetap tanggung jawab job CI di atas.
- **Temuan saat dokumentasi (false positive, terbuka):** run [#44933523091](https://github.com/Fundchainbinus/fundchain/actions/runs/44933523091) gagal di gitleaks (`generic-api-key`) pada field `onchainKey` di `evidence/gate1-proof.json` dan `evidence/bfd71-chain-info.json`. Nilainya bytes32 publik dari Hardhat lokal, bukan secret.
  - Field itu sudah dibuang dari bukti (harness kini tidak menulisnya), dan run berikutnya bersih.
  - Commit `1913ac2` di riwayat branch masih memuatnya. Scan riwayat penuh di `ci.yml` akan menandainya saat PR ke `main`.
  - Ada dua cara memperbaikinya, dan keduanya butuh keputusan pemilik repo: tulis ulang riwayat branch, atau tambahkan pengecualian di `.gitleaks.toml`.
- JSON di `docs/qa/evidence/` identik dengan artifact `e2e-evidence` run #44932667635, kecuali field `onchainKey` yang dihapus.

## Yang tidak diuji otomatis

- Session hijack lewat JavaScript: atribut HttpOnly sudah dibuktikan (S-11), tapi XSS nyata tidak dicoba.
- Upload PDF yang benar-benar berisi malware: tidak ada antivirus di pipeline. Yang diuji hanya validasi tipe file (magic bytes).
- Rate limit `verify` admin (10/menit) tidak di-spam secara khusus. Mekanismenya sama dengan S-07 (`@Throttle`).

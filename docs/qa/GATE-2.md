# QA Gate 2: Payment + Tamper (BFD-67, BFD-53)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:57 UTC (22 Nov 2026 00:57 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f` |
| Artifact (30 hari) | `e2e-evidence`, `e2e-playwright-report`, `e2e-stack-logs` (`api-unit-test.log`) |
| Spec | [`e2e/specs/02-gate2-tamper.spec.ts`](../../e2e/specs/02-gate2-tamper.spec.ts) (tamper); bagian webhook ada di [`04-security.spec.ts`](../../e2e/specs/04-security.spec.ts) (S-05/S-06) |
| Hasil | **PASS (untuk payment mock + tamper)**: 9/9 langkah tamper, webhook 2/2. Pakasir sandbox **tidak diuji** (lihat Catatan). |

## Environment

Sama dengan [GATE-1](GATE-1.md#environment), dengan tambahan `INTEGRITY_CHECK_INTERVAL_MS=15000` supaya hash checker otomatis bisa dibuktikan dalam satu run. Sweep worker sendiri tetap berjalan tiap 60 detik. `demo:tamper` dijalankan dengan `ALLOW_DEMO_TAMPER=true` ke DB lokal runner. Guard script mengizinkannya karena host-nya `localhost`.

## Langkah

| # | Langkah | Expected | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| G2-01 | Siapkan campaign ACTIVE, donasi Rp100.000 CONFIRMED, pengajuan pencairan REQUESTED | `match=true`, REQUESTED | Donasi CONFIRMED (tx `0x675a…6587`), pencairan Rp50.000 REQUESTED | PASS | |
| G2-02 | `demo:tamper <id> 900000 --json` | `{status: TAMPERED, currentHash != onChainHash, campaignFrozen: true}` | `{"status":"TAMPERED","currentHash":"0xfd13…a859","onChainHash":"0x54d6…48ef","campaignFrozen":true}` | PASS | [json](evidence/gate2-demo-tamper.json) |
| G2-03 | API: campaign & proof | Campaign FROZEN; proof `match=false` | FROZEN ("Integrity check: … TAMPERED"); `match=false`, `currentHash` ≠ `hashOnChain` (`hashDb` = `hashOnChain`) | PASS | [json](evidence/gate2-proof-tampered.json) |
| G2-04 | Pencairan terkunci | Ajukan baru dan approve pengajuan lama → 409 | Keduanya `409 CAMPAIGN_FROZEN` | PASS | |
| G2-05 | Audit log | `INTEGRITY_TAMPERED` berisi sumber, hash, IP, UA | Entri `source=DEMO` (script) dan `source=MANUAL` dengan IP `10.0.2.10` + UA `FundChain-QA-E2E/1.0`; `storedHash`/`currentHash`/`onChainHash`/`txHash`/`currentData` ada; `CAMPAIGN_FROZEN` tercatat | PASS | [json](evidence/gate2-audit-integrity-tampered.json) |
| G2-06 | UI | Proof page "TAMPERED", campaign dibekukan | Banner TAMPERED dan hash on-chain bertanda merah; campaign "Kampanye dibekukan…" | PASS | [png](evidence/gate2-01-bukti-tampered.png), [png](evidence/gate2-02-campaign-frozen.png) |
| G2-07 | Unfreeze saat masih TAMPERED | Ditolak | `409 CAMPAIGN_FROZEN`: "Masih ada 1 donasi TAMPERED…" | PASS | |
| G2-08 | Pulihkan nominal lalu unfreeze | VERIFIED, lalu ACTIVE | `demo:tamper <id> 100000 --json` → `VERIFIED` (hash kembali sama); unfreeze sukses, campaign ACTIVE | PASS | [json](evidence/gate2-restore.json) |
| G2-09 | Checker otomatis tanpa klik admin | Tamper tanpa `--check` terdeteksi worker | `INTEGRITY_TAMPERED` dengan `source=SCHEDULED` saja (tanpa MANUAL), campaign FROZEN ±70 dtk setelah tamper | PASS | [json](evidence/gate2-auto-checker.json) |

### Webhook (bagian "payment" Gate 2, dari `04-security.spec.ts`)

| Kasus | Expected | Actual | Status |
| --- | --- | --- | --- |
| Webhook valid | 200, PAID | `200 replayed=false status=PAID` | PASS |
| Webhook dobel | 200 idempoten | `200 replayed=true`; saldo campaign tidak bertambah | PASS |
| Webhook palsu (secret salah, tanpa signature, signature ngawur, signature dari body lain) | 401 | Semua `401 PAYMENT_SIGNATURE_INVALID`; donasi tetap PENDING | PASS |
| Amount mismatch | 400 | `400 PAYMENT_AMOUNT_MISMATCH` | PASS |
| Order tidak dikenal | 404 | `404` | PASS |

Bukti: [`evidence/bfd69-security.json`](evidence/bfd69-security.json) (S-05, S-06)

### Unit test

`pnpm --filter @fundchain/api test` dijalankan di workflow yang sama: 19 file, 322 test, semua lulus, termasuk `src/integrity.test.ts`. Log: [`evidence/api-unit-test.log`](evidence/api-unit-test.log)

## Catatan

- **Pakasir sandbox tidak diuji.** Entry criteria Gate 2 menyebut credential sandbox Pakasir, dan aturan harness melarang key asli, jadi kasus khusus Pakasir di 12-TESTING-PLAN §7 (re-fetch `/transactiondetail`, `PAKASIR_PROJECT` mismatch, Pakasir down → PENDING) belum dibuktikan. Gerbang ini lulus untuk jalur mock. Pakasir perlu dijalankan manual dengan credential sandbox.
- Respons `POST /admin/campaigns/:id/unfreeze` berstatus `201`, bukan `200` (tidak ada `@HttpCode(200)`). Kosmetik (S4) dan tidak memengaruhi web.
- Checklist Gate 2 di [`TAMPER-DEMO-RUNBOOK.md`](../blockchain/TAMPER-DEMO-RUNBOOK.md#checklist-lulus-gate-2) sudah dicentang untuk item yang terbukti di run ini. "Tidak ada bug S1/S2" sengaja tidak dicentang karena pernyataan negatif butuh sign-off QA/TL, bukan satu run.

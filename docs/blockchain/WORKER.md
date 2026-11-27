# Worker Notarisasi Blockchain

Cara kerja `NotarizationWorker` (`apps/api/src/modules/blockchain/notarization.worker.ts`), yang mencatat hash donasi ke contract `DonationRegistry` di Sepolia, serta cara memantau dan memulihkannya.

Relayer adalah satu-satunya wallet yang mengirim transaksi. Private key-nya hanya ada di environment API (`RELAYER_PRIVATE_KEY`) dan tidak pernah dikirim ke web. Semua monitoring di dokumen ini read-only.

## 1. Cara worker berjalan

Antrean disimpan di tabel `blockchain_transactions` (outbox pattern, tanpa Redis). Satu baris mewakili satu donasi PAID.

| Mode | `WORKER_MODE` | Pemicu |
| --- | --- | --- |
| Server biasa / lokal | `interval` (default) | `setInterval` tiap `WORKER_POLL_MS` (default 2 dtk) |
| Vercel (production) | `on-demand` | (1) **cron**: Supabase `pg_cron` memanggil `GET /api/v1/cron/tick` tiap 5 menit (D-017, `docs/infra/CRON-SCHEDULER.md`); cadangan: `.github/workflows/cron-tick.yml` dan Vercel Cron harian (`vercel.json` `0 0 * * *`); (2) **kick on event**: `worker.kick()` setelah webhook pembayaran PAID, simulasi bayar, polling status donasi yang belum selesai, dan manual retry admin. `kick()` memakai `waitUntil()` supaya tick selesai setelah response terkirim |

Satu tick (`tick()`) berjalan berurutan dan tidak pernah paralel di instance yang sama:

1. Housekeeping (maks. sekali per menit): pembayaran kedaluwarsa, campaign lewat deadline, soft-delete campaign FROZEN.
2. `alertStuck()`: alert untuk notarisasi macet. Berjalan sebelum cek RPC supaya antrean yang macet karena RPC mati tetap terdeteksi.
3. `health()`: RPC hidup, `eth_chainId` sama dengan `CHAIN_ID`, dan contract ada. Bila tidak siap, notarisasi ditunda tanpa memakai jatah retry.
4. `recoverStuck()`: menyelesaikan job SUBMITTED yang menggantung.
5. `checkRelayerBalance()`: warning bila saldo relayer rendah (lihat §7).
6. Memproses maksimal 5 job `QUEUED`/`RETRYING` yang `nextAttemptAt <= now`, hanya job milik `CHAIN_ID` aktif.
7. `integritySweep()`: hash checker otomatis.

Setiap tick lebih dulu mengambil **lease lintas instance** (BFD-127, `tick-lease.ts`): baris `system_state.cron_tick` diklaim dengan UPDATE bersyarat selama 55 detik, sehingga hanya satu tick berjalan di seluruh instance; yang kalah melewatkan putarannya. Akhir tick menyimpan `last_tick_at` dan durasi per langkah (BFD-128) untuk `GET /health`, dashboard admin, dan watchdog.

Bila lease kedaluwarsa di tengah tick yang sangat lambat, beberapa instance tetap bisa memproses antrean bersamaan. Tx dobel dicegah oleh:
- klaim atomic `updateMany(status IN (QUEUED, RETRYING) → SUBMITTED)`, sehingga hanya pemenang klaim yang mengirim tx;
- pengecekan `isNotarized(key)` sebelum mengirim;
- penundaan tanpa kirim ulang bila tx lama masih pending di mempool;
- revert contract `AlreadyNotarized`, yang dianggap CONFIRMED.

## 2. State

```
QUEUED ──klaim──▶ SUBMITTED ──receipt + N konfirmasi──▶ CONFIRMED
   ▲                 │
   │                 ├─ error sementara ──▶ RETRYING ──jatuh tempo──▶ (klaim lagi)
   │                 ├─ ALREADY_KNOWN ──▶ tetap SUBMITTED (diselesaikan recoverStuck)
   │                 └─ ZeroHash / INSUFFICIENT_FUNDS / retry habis ──▶ FAILED
   └──────────── manual retry admin (FAILED → QUEUED) ◀─────────────────────┘
```

| Status | Arti |
| --- | --- |
| `QUEUED` | Menunggu dikirim |
| `SUBMITTED` | Tx terkirim (`txHash` tersimpan) dan menunggu konfirmasi, atau sedang diklaim instance lain |
| `RETRYING` | Percobaan gagal, menunggu `nextAttemptAt` |
| `CONFIRMED` | Hash tercatat on-chain dengan konfirmasi cukup. Diikuti verifikasi awal (`INTEGRITY_VERIFIED`) |
| `FAILED` | Berhenti dan butuh tindakan admin (§6) |

Invariant: worker tidak pernah mengubah status donasi PAID (BR-BC-004).

## 3. Retry dan backoff

- Error sementara (RPC timeout, koneksi putus, tx di-revert chain, tx dropped) membuat job `RETRYING` dengan backoff 2 dtk, 4 dtk, 8 dtk, lalu 16 dtk.
- Batasnya `LIMITS.NOTARIZE_MAX_ATTEMPTS` (5). Percobaan ke-5 yang gagal membuat job `FAILED` dan mencatat audit `BLOCKCHAIN_NOTARIZE_FAILED`.
- `lastError` menyimpan penyebab terakhir (maks. 500 karakter), diawali kategori bila dikenali, misalnya `[NONCE_TOO_LOW] nonce too low`.
- Penundaan yang tidak memakai jatah retry: chain belum siap, tx lama masih pending (dicek ulang tiap 15 dtk), dan konfirmasi belum cukup.

## 4. Klasifikasi error relayer (BFD-49)

Sumber: `apps/api/src/modules/blockchain/relayer-errors.ts`. Klasifikasi memakai kode error ethers v6 (`INSUFFICIENT_FUNDS`, `NONCE_EXPIRED`, `REPLACEMENT_UNDERPRICED`) dan pencocokan pesan node (geth, Hardhat, Besu, Nethermind), termasuk pesan yang bersarang di `info.error` / `error` / `cause`. Revert contract (`AlreadyNotarized`, `ZeroHash`) selalu dicek lebih dulu.

| Kategori | Contoh pesan | Penanganan |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | `insufficient funds for gas * price + value` | Langsung **FAILED** tanpa menambah `retryCount`. Alert dikirim (`ALERT_WEBHOOK_URL`). Sisa batch tick dihentikan dan instance ini menjeda pengiriman 10 menit, sehingga antrean lain tetap QUEUED, tidak ikut FAILED |
| `NONCE_TOO_LOW` | `nonce too low`, `nonce has already been used` | Ambil nonce baru `getTransactionCount(relayer, 'pending')`, lalu kirim ulang langsung |
| `NONCE_CONFLICT` | `nonce too high`, `NonceGap` | Sama dengan di atas: nonce `pending` baru |
| `REPLACEMENT_UNDERPRICED` | `replacement transaction underpriced` | Nonce `pending` baru. Fee **tidak** dinaikkan di nonce lama, karena itu akan menggusur tx donasi lain yang sedang pending (penyebab umumnya dua instance memakai nonce yang sama) |
| `ALREADY_KNOWN` | `already known`, `known transaction` | Tx identik sudah ada di mempool. **Tidak dikirim ulang** (mencegah tx dobel). Job tetap SUBMITTED, lalu `recoverStuck()` mengonfirmasi atau mengirim ulang bila tx dropped |
| `GAS_UNDERPRICED` | `transaction underpriced`, `max fee per gas less than block base fee` | `maxFeePerGas` dan `maxPriorityFeePerGas` naik 25% dari nilai tertinggi antara fee jaringan dan fee percobaan sebelumnya (legacy: `gasPrice`) |
| `GAS_TOO_LOW` | `intrinsic gas too low` | Estimasi ulang gas, lalu `gasLimit` = estimasi × 1.5 |
| (tidak dikenal) | `socket hang up`, timeout | Retry dengan backoff biasa |

Perbaikan langsung dicoba maksimal 2 kali dalam satu percobaan (`SEND_REPAIR_ATTEMPTS`). Ini aman karena error-error tersebut berarti node menolak tx, jadi belum ada tx yang masuk mempool. Bila masih gagal, job menjadi `RETRYING` dengan kategori di `lastError`. Tick berikutnya, yang bisa berjalan di instance serverless lain, membaca prefix itu dan langsung menerapkan perbaikannya di kiriman pertama.

## 5. Konfirmasi blok (BFD-48)

- `BLOCKCHAIN_CONFIRMATIONS` default **2**, minimal 1, dan bisa di-override.
- Khusus Hardhat lokal (`CHAIN_ID=31337`), bila variabel kosong, default-nya 1. Hardhat automine membuat satu blok per tx, sehingga blok kedua baru muncul saat ada tx lain.
- Jalur konfirmasi:
  - Kirim baru: `tx.wait(N, BLOCKCHAIN_CONFIRM_WAIT_MS)`. Bila timeout (default 45 dtk), job tetap SUBMITTED dan antrean tidak terkunci.
  - `recoverStuck()`: receipt dengan `status=1` dan `confirmations() >= N` menjadi CONFIRMED.
  - SUBMITTED > 2 menit dan hash sudah on-chain: bila receipt tx-nya ada, tetap menunggu N konfirmasi.
  - Idempotency (hash sudah on-chain saat job diambil lagi): bila tx milik job ini punya receipt dengan konfirmasi < N, job ditunda.
- Production: pastikan env Vercel `BLOCKCHAIN_CONFIRMATIONS` di-set 2 atau dibiarkan kosong. Nilai lama `1` di `.env` hasil salinan template lama akan meng-override default.

## 6. Alert macet dan manual retry

**Macet.** Job `QUEUED`/`SUBMITTED`/`RETRYING` yang lebih tua dari `STUCK_TX_ALERT_MS` (default 10 menit) sejak masuk antrean memicu audit `BLOCKCHAIN_TX_STUCK` dan alert ke `ALERT_WEBHOOK_URL`. Alert dikirim **sekali per donasi** (deduplikasi lewat audit log). Pengecekan berjalan maksimal sekali per menit dan tetap berjalan walau RPC mati.

**Manual retry.** `POST /api/v1/admin/blockchain/:donationId/retry` (role ADMIN; UI: Admin → Integritas → Retry)

| Kondisi | Respons |
| --- | --- |
| Status `FAILED` | 200 `{ donationId, status: 'QUEUED' }`. `retryCount` = 0, `lastError` = null, audit `BLOCKCHAIN_RETRY_REQUESTED` (actor, IP, User-Agent), worker di-kick |
| Status lain | 409 `BLOCKCHAIN_INVALID_STATUS` |
| Donasi tanpa record notarisasi | 404 `DONATION_NOT_FOUND` |
| Bukan admin / belum login | 403 `AUTH_FORBIDDEN` / 401 `AUTH_UNAUTHENTICATED` |

Hash yang dikirim ulang tetap hash saat settlement, bukan dihitung ulang. Dengan begitu data yang sudah dimanipulasi tetap terdeteksi.

## 7. Monitoring saldo relayer (BFD-73 / BFD-32)

| Lapisan | Di mana | Perilaku |
| --- | --- | --- |
| Admin dashboard | `GET /api/v1/admin/stats` → `chain.relayer` | `balance`, `lowBalance`, `minBalance` |
| Log worker | `checkRelayerBalance()` | Maksimal sekali per 5 menit per instance. Saldo < `RELAYER_MIN_BALANCE_ETH` (default 0.02) menghasilkan `WARN` di log. Hanya log, tanpa webhook |
| GitHub Actions | `.github/workflows/relayer-balance.yml` | Tiap jam (menit ke-17) dan manual. Cek read-only `eth_getBalance`. Bila di bawah threshold: pesan ke `DISCORD_WEBHOOK_URL` dan job merah. Tanpa private key |
| Manual (Hardhat) | `contracts/scripts/saldo_relayer.ts` | `pnpm --filter @fundchain/contracts monitor:relayer` (read-only; alamat dari `deployments/sepolia.json` atau `MONITOR_RELAYER_ADDRESS`) |

Konfigurasi workflow (Settings → Secrets and variables → Actions):
- `RELAYER_ADDRESS`: repo variable atau secret, alamat publik relayer. **Wajib**; bila kosong, job gagal dengan pesan jelas.
- `RELAYER_MIN_BALANCE_ETH`: variable, opsional (default 0.02).
- `SEPOLIA_RPC_URL`: secret, opsional. Bila kosong, memakai RPC publik `ethereum-sepolia-rpc.publicnode.com`.
- `DISCORD_WEBHOOK_URL`: secret. Bila kosong, alert hanya muncul di log workflow.

## 8. Monitoring biaya gas (BFD-92)

Saat CONFIRMED dari receipt, worker menyimpan kolom berikut (nullable, `DECIMAL(78,0)`, wei):
- `gas_used`
- `effective_gas_price` (receipt ethers v6 `gasPrice`)
- `fee_wei` = `gas_used × effective_gas_price`

`gasUsed` dan `feeWei` juga tercatat di metadata audit `BLOCKCHAIN_NOTARIZED`. Konfirmasi tanpa receipt sukses milik job tersebut menyimpan null. Contohnya: hash sudah on-chain dari percobaan yang hash tx-nya tidak tercatat, atau receipt tx job ini revert.

Agregat ada di `GET /api/v1/admin/stats` → `chain.fees`, berupa dua query `aggregate` untuk chain aktif:

```json
{ "count": 12, "totalFeeEth": "0.0031", "avgFeeEth": "0.000258", "totalGasUsed": "580000",
  "last24h": { "count": 3, "totalFeeEth": "0.0008", "avgFeeEth": "0.000266" } }
```

- `count` dan rata-rata hanya dihitung dari baris yang punya data biaya. Data lama sebelum migration bernilai null dan tidak ikut.
- Bila query gagal, `fees: null`, sehingga dashboard tetap tampil.
- Endpoint publik `GET /api/v1/blockchain/info` tidak menyertakan `fees`.

Deploy: migration `20261121000300_tx_gas_fee` **wajib** dijalankan (`pnpm --filter @fundchain/api db:deploy`) **sebelum** kode baru di-deploy ke Vercel. Build Vercel tidak menjalankan migrate, dan Prisma Client baru memilih kolom ini di setiap query `blockchain_transactions`.

## 9. Playbook pemulihan

| Gejala | Diagnosis | Tindakan |
| --- | --- | --- |
| Banyak `FAILED` dengan `[INSUFFICIENT_FUNDS]` | Saldo relayer habis (alert Discord / workflow merah) | Isi saldo relayer dari faucet Sepolia ke `RELAYER_ADDRESS`, tunggu masuk blok, lalu Retry tiap donasi FAILED di Admin → Integritas |
| Antrean tidak bergerak, log `Blockchain belum siap` | RPC mati, `CHAIN_ID` salah, atau contract tidak ada | Cek `BLOCKCHAIN_RPC_URL`, `CHAIN_ID=11155111`, `CONTRACT_ADDRESS`. Job tidak memakai jatah retry selama menunggu |
| Antrean tidak bergerak di production, tanpa error | Cron tidak jalan | Cek run `Cron tick` di GitHub Actions dan secret `CRON_SECRET`. Jalankan manual lewat *Run workflow* |
| `RETRYING` berulang dengan `[NONCE_*]` / `[REPLACEMENT_UNDERPRICED]` | Bentrok nonce antar instance | Biasanya pulih sendiri. Bila menetap, cek tx pending relayer di Etherscan (nonce macet karena fee terlalu rendah) |
| `RETRYING` dengan `[GAS_UNDERPRICED]` | Base fee Sepolia melonjak | Pulih sendiri karena fee naik 25% per perbaikan. Pantau `chain.fees` |
| `SUBMITTED` lama dengan `[ALREADY_KNOWN]` | Tx sudah di mempool | Tunggu. `recoverStuck()` mengonfirmasi bila masuk blok, atau mengirim ulang setelah 2 menit bila dropped |
| `FAILED` "Donasi bukan PAID atau hash kosong" | Data donasi tidak valid untuk notarisasi | Investigasi data. Jangan retry sebelum donasi benar-benar PAID dengan hash |
| `FAILED` `ZeroHash` | Hash nol ditolak contract | Bug data/settlement. Retry tidak akan berhasil |
| Alert `BLOCKCHAIN_TX_STUCK` | Job > 10 menit belum CONFIRMED | Lihat `status` dan `lastError` di pesan alert, lalu ikuti baris yang sesuai di atas |
| Hardhat lokal di-restart | Chain in-memory hilang | Otomatis: `resyncLocalChain()` mengantrekan ulang notarisasi memakai hash tersimpan |

Konfigurasi terkait: `BLOCKCHAIN_CONFIRMATIONS`, `BLOCKCHAIN_CONFIRM_WAIT_MS`, `RELAYER_MIN_BALANCE_ETH`, `ALERT_WEBHOOK_URL`, `STUCK_TX_ALERT_MS`, `WORKER_MODE`, `WORKER_POLL_MS`, `CRON_SECRET` (lihat `apps/api/.env.example`).

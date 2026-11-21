# Runbook: Verifikasi Contract & Rotasi Relayer (BFD-29 / BFD-30)

Untuk: **pemegang wallet admin** `DonationRegistry` di Sepolia (BC lead).  
Contract: [`0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2`](https://sepolia.etherscan.io/address/0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2)  
Admin: `0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3` · Relayer saat ini: `0x04ae100476632717De6Fb2A622DB8062c9eBBF89`

Semua langkah di bawah dijalankan dari folder `contracts/`. Tidak ada private key yang
diketik di command line atau di-commit. Key dibaca dari `contracts/.env`, yang
di-ignore Git.

| Variabel `contracts/.env` | Isi | Dipakai oleh |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | private key wallet **admin** (`0xfC2D…c1f3`) | grant / revoke |
| `SEPOLIA_RPC_URL` | opsional, default publicnode | semua |
| `ETHERSCAN_API_KEY` | API key Etherscan (gratis, akun etherscan.io) | verify |

Sebelum mulai:

```bash
pnpm install
cd contracts
npx hardhat test          # harus semua lulus, termasuk test/RelayerRole.test.ts
npx hardhat run scripts/smoke.ts --network sepolia   # read-only: Relayer ok = true
```

---

## 1. Verifikasi source contract di Etherscan

Status per 2026-11-21: **belum terverifikasi** (lihat
[evidence/SEPOLIA-E2E.md](evidence/SEPOLIA-E2E.md)). Setelah verifikasi, tab *Read
Contract* di Etherscan bisa dipakai juri/auditor untuk memanggil `verify(bytes32)`.

Constructor args (dicatat di `deployments/sepolia.json` → `constructorArgs`):

```text
admin   = 0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3
relayer = 0x04ae100476632717De6Fb2A622DB8062c9eBBF89   (relayer SAAT DEPLOY)
```

> Argumen kedua harus relayer **awal**, walaupun nanti relayer sudah dirotasi. Karena itu
> `constructorArgs` disimpan terpisah dari field `relayer`.

Opsi A, script (membaca args dari `deployments/sepolia.json`):

```bash
npx hardhat run scripts/verify-contract.ts --network sepolia
```

Opsi B, manual:

```bash
npx hardhat verify --network sepolia \
  0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2 \
  0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3 \
  0x04ae100476632717De6Fb2A622DB8062c9eBBF89
```

Config verifikasi ada di `hardhat.config.ts`: `etherscan.apiKey` dari env
`ETHERSCAN_API_KEY` (hardhat-verify 2.1.x memakai Etherscan API v2) dan
`sourcify.enabled = true`. Sourcify tidak butuh key. `verify-contract.ts` menjalankan
Etherscan dan Sourcify secara terpisah, jadi Sourcify tetap dicoba walau Etherscan gagal
atau key kosong. Exit code 1 hanya kalau keduanya gagal. Compiler harus sama dengan saat deploy
(`0.8.24`, optimizer 200 runs, evm `cancun`). **Jangan** ubah setting `solidity` di config
sebelum verifikasi.

Cek hasil:

- `https://sepolia.etherscan.io/address/0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2#code`
  menampilkan centang hijau *Contract Source Code Verified*.
- Tab *Read Contract* → `verify` dengan key dari evidence, mis.
  `0x1db2b50a1f3c083cc45fbf3c623d29e99e4f82fc6a95d5e19c238fa08c89619a` → harus
  `0x6fc43a34…5dd15`.
- Kalau muncul *"already verified"*, berarti sudah terverifikasi dan tidak perlu diulang.
- Kalau muncul *"bytecode doesn't match"*, cek versi compiler/optimizer dan pastikan
  constructor args memakai relayer awal.

---

## 2. Rotasi relayer (grant baru → ganti key → revoke lama)

Kapan: key relayer bocor/dicurigai bocor, pergantian anggota tim yang memegang key, atau
rotasi berkala. **Urutan penting.** Kalau yang lama dicabut sebelum yang baru aktif,
notarisasi akan gagal (`AccessControlUnauthorizedAccount`). Worker memang akan me-retry,
tapi status donasi tertahan di `RETRYING`/`FAILED`.

> Pengecualian, key **sudah pasti bocor dan disalahgunakan**: jalankan langkah 2.6
> (revoke) lebih dulu. Downtime notarisasi lebih baik daripada hash palsu. Donasi tetap
> `PAID` dan antrean notarisasi diproses ulang setelah relayer baru aktif.

### 2.1 Buat wallet relayer baru

- Buat wallet baru (MetaMask akun baru, atau `cast wallet new`) di perangkat pemegang key.
  Wallet ini harus **berbeda** dari wallet admin.
- Catat **address**-nya saja. Private key hanya dipindahkan ke Vercel (langkah 2.4),
  jangan dikirim lewat chat atau di-commit.

### 2.2 Isi saldo relayer baru

- Kirim Sepolia ETH dari faucet atau dari relayer lama, minimal **0.05 ETH** (threshold
  monitor 0.02 ETH).
- Cek: `MONITOR_RELAYER_ADDRESS=<baru> npx hardhat run scripts/saldo_relayer.ts --network sepolia`
  → `Status : OK`.

### 2.3 Grant `RELAYER_ROLE` ke relayer baru

```bash
NEW_RELAYER_ADDRESS=0x<relayer-baru> npx hardhat run scripts/grant-relayer.ts --network sepolia
```

PowerShell:

```powershell
$env:NEW_RELAYER_ADDRESS = "0x<relayer-baru>"; npx hardhat run scripts/grant-relayer.ts --network sepolia
```

Pengecekan yang dilakukan script (`scripts/lib/relayer-role.ts`):

1. chainId RPC sama dengan `deployments/sepolia.json` (11155111).
2. Signer memegang `DEFAULT_ADMIN_ROLE`. Kalau tidak, script berhenti **sebelum** kirim tx.
3. `hasRole(RELAYER_ROLE, baru)` sebelum. Kalau sudah `true`, script tidak mengirim tx.
4. Kirim `grantRole`, cetak **tx hash** + link Etherscan, lalu tunggu 2 konfirmasi.
5. `hasRole` sesudah harus `true`. Kalau tidak, script error.

Output yang diharapkan (ringkas):

```text
hasRole(RELAYER_ROLE) sebelum: false
Tx hash  : 0x...
hasRole(RELAYER_ROLE) sesudah: true (blok ...)
Etherscan: https://sepolia.etherscan.io/tx/0x...
```

Catat tx hash di tabel log di bawah. Di Etherscan, tab *Logs* tx tersebut harus
menampilkan event `RoleGranted(role=RELAYER_ROLE, account=<baru>, sender=<admin>)`.

### 2.4 Ganti key relayer di Vercel

Backend membaca env berikut (`apps/api/src/common/env.ts`):

| Env Vercel | Aksi |
| --- | --- |
| `RELAYER_PRIVATE_KEY` | **ganti** dengan private key relayer baru |
| `CONTRACT_ADDRESS` | tetap `0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2` |
| `CHAIN_ID` | tetap `11155111` |
| `BLOCKCHAIN_RPC_URL` | tetap |

Langkah:

1. Vercel Dashboard → project API → *Settings* → *Environment Variables* →
   `RELAYER_PRIVATE_KEY` → *Edit* → tempel key baru. Lakukan untuk environment
   **Production** dan **Preview** jika keduanya dipakai.
2. *Deployments* → deployment production terakhir → **Redeploy**. Env baru hanya terbaca
   setelah redeploy.
3. Jangan pernah menyimpan key di file yang di-commit. Hapus key dari clipboard/catatan
   setelah selesai.

### 2.5 Uji notarisasi dari relayer baru

1. Buat satu donasi uji (mock/sandbox payment) sampai status `PAID`.
2. Tunggu worker memproses. Status notarisasi harus `CONFIRMED`.
3. Buka tx di Etherscan. Field **From** harus address relayer **baru**, dan event
   `DonationNotarized.notarizedBy` = relayer baru.
4. Alternatif read-only: `npx ts-node scripts/collect-evidence.ts`. Event terbaru harus
   menunjukkan `notarizedBy` relayer baru.

Lanjut ke langkah 2.6 **hanya** jika 2.5 berhasil.

### 2.6 Revoke `RELAYER_ROLE` dari relayer lama

```bash
OLD_RELAYER_ADDRESS=0x04ae100476632717De6Fb2A622DB8062c9eBBF89 \
  npx hardhat run scripts/revoke-relayer.ts --network sepolia
```

PowerShell:

```powershell
$env:OLD_RELAYER_ADDRESS = "0x04ae100476632717De6Fb2A622DB8062c9eBBF89"; npx hardhat run scripts/revoke-relayer.ts --network sepolia
```

Hasil yang diharapkan: `hasRole sebelum: true` → tx hash → `hasRole sesudah: false`. Di
Etherscan muncul event `RoleRevoked`. Hash yang sudah dinotarisasi relayer lama **tetap
valid**: revoke tidak menghapus record, dan `verify()` tetap mengembalikan hash yang sama.

Sisa saldo relayer lama boleh dikirim ke relayer baru, kecuali key-nya bocor (dalam kasus
itu biarkan saja).

### 2.7 Update artefak repo

1. `contracts/deployments/sepolia.json`: ubah **hanya** field `relayer` ke address baru.
   **Jangan** ubah `constructorArgs`, `address`, `admin`, atau `blockNumber`.
   `smoke.ts` dan `saldo_relayer.ts` membaca field `relayer`.
2. Commit dengan pesan, mis. `chore(contracts): BFD-30 rotasi relayer ke 0x<baru>`, dan
   sertakan tx hash grant/revoke di deskripsi PR.

### 2.8 Pengecekan akhir

```bash
npx hardhat run scripts/smoke.ts --network sepolia          # Relayer ok: true (relayer baru)
npx hardhat run scripts/saldo_relayer.ts --network sepolia  # Status: OK
npx ts-node scripts/collect-evidence.ts                     # roles.relayerHasRole = true
```

Checklist:

- [ ] `hasRole(RELAYER_ROLE, baru)` = true
- [ ] `hasRole(RELAYER_ROLE, lama)` = false
- [ ] `hasRole(DEFAULT_ADMIN_ROLE, admin)` = true (admin tidak berubah)
- [ ] Satu notarisasi baru `CONFIRMED` dengan `notarizedBy` = relayer baru
- [ ] Integrity check donasi lama tetap `VERIFIED`
- [ ] `RELAYER_PRIVATE_KEY` lama sudah tidak ada di Vercel / catatan mana pun
- [ ] `deployments/sepolia.json` field `relayer` sudah diperbarui dan di-commit

---

## 3. Rollback

- Relayer baru bermasalah sebelum langkah 2.6: kembalikan `RELAYER_PRIVATE_KEY` lama di
  Vercel lalu redeploy. Relayer lama masih punya role. Opsional: revoke relayer baru.
- Relayer lama sudah di-revoke dan relayer baru bermasalah: grant ulang ke relayer yang
  sehat (`grant-relayer.ts`), lalu kembalikan key di Vercel.
- Wallet **admin** hilang: role tidak bisa diubah lagi. Satu-satunya jalan adalah deploy
  contract baru (`deploy:sepolia`) dan migrasi `CONTRACT_ADDRESS`, dengan konsekuensi
  hash lama tetap berada di contract lama. Simpan wallet admin offline dan punya backup.

## 4. Bukti yang sudah diuji lokal

`contracts/test/RelayerRole.test.ts` memakai fungsi yang **sama** dengan script
(`changeRelayerRole`) di jaringan Hardhat lokal:

- admin grant ke wallet baru → wallet itu bisa `notarize` (event `DonationNotarized`
  dengan `notarizedBy` = wallet baru);
- setelah revoke → `notarize` revert `AccessControlUnauthorizedAccount`, record lama tetap;
- rotasi penuh (grant baru, revoke lama) → hanya relayer baru yang bisa notarize;
- non-admin (stranger/relayer) tidak bisa `grantRole`/`revokeRole`;
- script menolak signer non-admin tanpa mengirim tx, dan idempotent (tidak kirim tx bila
  state sudah sesuai).

## Log eksekusi Sepolia

Diisi oleh admin setelah eksekusi.

| Tanggal | Aksi | Address | Tx hash | Oleh |
| --- | --- | --- | --- | --- |
| | verify source | `0x3Aa2…35b2` | – | |
| | grant RELAYER_ROLE | | | |
| | revoke RELAYER_ROLE | `0x04ae…BF89` | | |

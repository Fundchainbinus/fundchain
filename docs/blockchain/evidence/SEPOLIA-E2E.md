# Bukti End-to-End Notarisasi di Sepolia (BFD-50 / BFD-90)

Tanggal pengambilan: **21 November 2026** (`collectedAt` 2026-11-21T12:34:41Z)  
Metode: **read-only** lewat RPC publik tanpa API key dan tanpa private key. Tidak ada
transaksi yang dikirim saat mengumpulkan bukti ini.

## Contract

| Item | Nilai |
| --- | --- |
| Network | Sepolia (chainId `11155111`) |
| Contract `DonationRegistry` | [`0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2`](https://sepolia.etherscan.io/address/0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2) |
| Admin (`DEFAULT_ADMIN_ROLE`) | [`0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3`](https://sepolia.etherscan.io/address/0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3), `hasRole` = **true** |
| Relayer (`RELAYER_ROLE`) | [`0x04ae100476632717De6Fb2A622DB8062c9eBBF89`](https://sepolia.etherscan.io/address/0x04ae100476632717De6Fb2A622DB8062c9eBBF89), `hasRole` = **true** |
| Blok deploy | `11829714` (2026-10-02) |
| Blok terakhir yang dipindai | `12181864` |
| Saldo relayer | **0.048436807327683857 ETH** (di atas threshold monitor 0.02 ETH) |
| Status verifikasi source | **Belum terverifikasi per 2026-11-21.** Sourcify API mengembalikan 404 untuk address ini. Status Etherscan tidak bisa dicek otomatis tanpa API key. Langkah verifikasi ada di [RELAYER-ROLE-RUNBOOK.md](../RELAYER-ROLE-RUNBOOK.md#1-verifikasi-source-contract-di-etherscan) |

## Ringkasan

- **16 event `DonationNotarized`** ditemukan dari blok deploy sampai blok `12181864`.
- Semua event dikirim oleh satu wallet: relayer `0x04ae…BF89`. Admin tidak pernah
  notarize, sesuai pemisahan role.
- Notarisasi pertama terjadi di blok `11829721`, 7 blok setelah deploy. Notarisasi
  terakhir terjadi di blok `11834319` (2026-10-03 07:20 UTC). Setelah itu tidak ada event
  baru sampai tanggal pengambilan.
- 3 sampel (event pertama, tengah, terakhir) dicek ulang dengan `verify(donationId)`.
  Ketiganya mengembalikan hash yang sama dengan hash di event (**MATCH**).

## Daftar event `DonationNotarized`

Kolom `donationId key` adalah `toOnchainKey(uuid)` = `keccak256(lowercase(uuid))`
(lihat [`packages/shared/README.md`](../../../packages/shared/README.md)). Waktu diambil
dari timestamp blok (UTC).

| # | Tx | Blok | Waktu (UTC) | donationId key | hash |
|---|----|------|-------------|----------------|------|
| 1 | [0xcbb4a20d...](https://sepolia.etherscan.io/tx/0xcbb4a20d03f315db87015947154b4e96c6189c7bc0ba843c8381b116c22dc685) | 11829721 | 2026-10-02T14:56:48Z | `0x1db2b50a1f3c083cc45fbf3c623d29e99e4f82fc6a95d5e19c238fa08c89619a` | `0x6fc43a3469d0c416d18261dc9c9cd11846c856a1de9e0155635747765305dd15` |
| 2 | [0x4452b8f3...](https://sepolia.etherscan.io/tx/0x4452b8f3a21c5330d14bcb9bd0151e501630e445c2a6042fe787e670b04882a6) | 11829731 | 2026-10-02T14:58:48Z | `0x14b0e5863bff7fc514ffd629769db14e47b40d543770be764650c633e3600afe` | `0xb426a0ac8aa643717986004f1c3b62f8fd076b63f73104fa45497af1e1ca27f3` |
| 3 | [0x1d9c8b3d...](https://sepolia.etherscan.io/tx/0x1d9c8b3d433b87b2d93020139cd95d9cc77a30845008a2da270d3e139d1d69f2) | 11829733 | 2026-10-02T14:59:12Z | `0x4503458ff6e2afcad7607bca052ebf83c6f83cbe5e31af0458dd10f4430336c2` | `0xf7c79c8c6f7050bd987b35a12dd0ce7251164a52c4693e2b8fc6c90d23b92f18` |
| 4 | [0xc1294dc6...](https://sepolia.etherscan.io/tx/0xc1294dc66d4a72b8ac0ef6aea8b5203c8453bd8004a62e40a631b2330b346694) | 11829734 | 2026-10-02T14:59:24Z | `0xd654fbba6b0002f166137042316d928b6097b596ae846ceafc0cc97012d287fa` | `0xfe4588740396182d44cf339d3920a75997f80aa69e5acf531966e32d2f144e38` |
| 5 | [0xf523e686...](https://sepolia.etherscan.io/tx/0xf523e68687eb41c5e7e2a65692280f25c11a9e2b82bb9bfb6df8d25a31ec4c30) | 11829735 | 2026-10-02T14:59:36Z | `0xf667d584f1512b2f7a6458b239adec0e5b1b5e3ca2cb26e906e6c6545813719d` | `0x92a0ad2d014b15f3504caca8a0493f82080827070a7088b5e5c74c5f39291c6c` |
| 6 | [0xed248465...](https://sepolia.etherscan.io/tx/0xed2484655c464514f6ecce14415ac94e348a48e8ee54f06acf57080a608fb7bf) | 11829736 | 2026-10-02T14:59:48Z | `0xbc007376bf84e91966bd8df1e970d57b39f62a8528ad29fcb359206ef36c2424` | `0xca56e7d0be5a0e7849a41fc5dffb7a3e15d81458198d919d64f985793c4b479a` |
| 7 | [0x4151ea26...](https://sepolia.etherscan.io/tx/0x4151ea266f6a8345b3a7ddca951dfc2b720f7b60c0f71574a10ebe26a493035b) | 11829737 | 2026-10-02T15:00:00Z | `0x19e716a1731812f7b6af582271a2484a8da15fd7f06ac07955cf8eb04be42032` | `0xcdac3b87712a741d8e0d3559f03f8c20a354c01e7dbbda6f231cd0634428493b` |
| 8 | [0xec58291e...](https://sepolia.etherscan.io/tx/0xec58291e01dad72c919ee579a6fc43377ff40eafd3122d5fca66f0604ab847b2) | 11829738 | 2026-10-02T15:00:12Z | `0xa850d4f4e9931abc5506c34822d9f4a5fc354fbb94ec492814d71d750c6d8089` | `0x2cbdfb07ecbca97bf5f6063f73c373a8f2c9dd9a9a6cbc0ee89491edc86636c9` |
| 9 | [0xb123a091...](https://sepolia.etherscan.io/tx/0xb123a091cbde857968ae5523da4a795297080be384de4f516e1da0fd099989a9) | 11829739 | 2026-10-02T15:00:24Z | `0xebac3fd5787dbefc1ce53fab34af50fdf2151435823a44cc6b105f9f671df0bc` | `0xa76191ab02f81935c85848a4315ed0d3ca38d909da6e3d80b9d6c10d8d9355a9` |
| 10 | [0x7f95a483...](https://sepolia.etherscan.io/tx/0x7f95a483e773d9613c2a4d3ed88bd7b09870d225cce8fd7e027bcfd208b921e8) | 11829798 | 2026-10-02T15:12:12Z | `0x183ac9199cdb2e690a2f54de7f90fb55e67b31a5cb938b3dbf98764d266a48fc` | `0x6dd3a7da8af59c77a170b9997c37bf80fadf7b7d79d449cafd27d978645a4b11` |
| 11 | [0xbad0e539...](https://sepolia.etherscan.io/tx/0xbad0e539936456fc1b25066566cc939ae2019f17cccb059c08d176c5fda4c407) | 11829845 | 2026-10-02T15:21:36Z | `0x2b459cdabd54767fece00cebc9113959262b8470254db4362131bf5b33446831` | `0x3f40ba4a7cb5149740506e02bdc7c7b7a697dce6ea4d2064cb6164c3a9c6c0ad` |
| 12 | [0xc7cd2d98...](https://sepolia.etherscan.io/tx/0xc7cd2d981eb4d372934ad861fdcdfc3b0ec57fd382325cbfd23c77467056312c) | 11830381 | 2026-10-02T17:10:24Z | `0xc1d41eedc9c05e3957d0b7b4aa0931e90c8bf57acb31b04ee387c050dc9901b5` | `0x2489c3efc3024e06906caf71200b4b4b1cdba45b9fc3d460dd5afc388ea3b10b` |
| 13 | [0xc00f3412...](https://sepolia.etherscan.io/tx/0xc00f341261552776ab33e21f299ec99c01b4cb91e2383b6895178d9331351410) | 11830387 | 2026-10-02T17:11:36Z | `0xc2a87110623114ba3b8850ebf632163ed98e42de3b0605edb654d25f0b4c873b` | `0xebe9b3cdb6a5273dc7087666635a57f0df12c37ed761d5ab5bf3070e23f4e26d` |
| 14 | [0x3b36b7bf...](https://sepolia.etherscan.io/tx/0x3b36b7bfa4257d0aab2f609086aa60ecf604a0813de376e9f5a8c145b60ae1e5) | 11834104 | 2026-10-03T06:34:00Z | `0x4c2c09525f43065268f119bf1bd6ad5284cdf1bfe7a499b413d6f4ee20e5c015` | `0x41f6c08af89914859ef8404d2f75357a0389cdf845d212843c42b94a09afbc0f` |
| 15 | [0xd2f2d0ad...](https://sepolia.etherscan.io/tx/0xd2f2d0ade37b9c431db1008c7f288738645aceed68fde6ee92c6ba83e868f8f2) | 11834187 | 2026-10-03T06:52:00Z | `0x5e77a105ee1d56d2f9780b6f7e4af3452c3a59f4f08c9091c6486f1d3708f310` | `0xcbf6f6f57a673dceb45cf2c90d9cf5a98112bcf9550ea8900ea0a29e244d526b` |
| 16 | [0xfdba0eaf...](https://sepolia.etherscan.io/tx/0xfdba0eafdf119d741191c37a40d1dcfa86d0fc17927acc4b063af0de1a1f2720) | 11834319 | 2026-10-03T07:20:48Z | `0x7fdae8a64f60f479752168260ee04ee7037e6eacd087dff8ffe8c757fd2791dd` | `0x67d098ced9fb319ea1bed86a0f482ba77617b3cca1a827eb0cb0a5d53953b741` |

## Cek ulang `verify(donationId)` (state contract saat ini)

| Event | Tx | `verify(key)` | Hash di event | Hasil |
| --- | --- | --- | --- | --- |
| #1 | [0xcbb4a20d...](https://sepolia.etherscan.io/tx/0xcbb4a20d03f315db87015947154b4e96c6189c7bc0ba843c8381b116c22dc685) | `0x6fc43a3469d0c416d18261dc9c9cd11846c856a1de9e0155635747765305dd15` | `0x6fc43a3469d0c416d18261dc9c9cd11846c856a1de9e0155635747765305dd15` | **MATCH** |
| #9 | [0xb123a091...](https://sepolia.etherscan.io/tx/0xb123a091cbde857968ae5523da4a795297080be384de4f516e1da0fd099989a9) | `0xa76191ab02f81935c85848a4315ed0d3ca38d909da6e3d80b9d6c10d8d9355a9` | `0xa76191ab02f81935c85848a4315ed0d3ca38d909da6e3d80b9d6c10d8d9355a9` | **MATCH** |
| #16 | [0xfdba0eaf...](https://sepolia.etherscan.io/tx/0xfdba0eafdf119d741191c37a40d1dcfa86d0fc17927acc4b063af0de1a1f2720) | `0x67d098ced9fb319ea1bed86a0f482ba77617b3cca1a827eb0cb0a5d53953b741` | `0x67d098ced9fb319ea1bed86a0f482ba77617b3cca1a827eb0cb0a5d53953b741` | **MATCH** |

Event membuktikan *apa yang dikirim* saat notarisasi. `verify` membuktikan *apa yang
tersimpan sekarang* di storage contract. Keduanya identik, dan contract tidak punya
fungsi untuk menimpa record (`AlreadyNotarized`).

Langkah membuka manual di Etherscan:

1. Buka link tx, lalu tab **Logs**. Event `DonationNotarized` menampilkan `donationId`
   (topic 1) dan `hash` (data).
2. Jika source sudah diverifikasi, buka tab *Read Contract*, lalu `verify`. Selama source
   belum terverifikasi, tab itu tidak tersedia. Panggil `verify(bytes32)` lewat script di
   bawah, Remix (*At Address* + ABI), atau `cast call`.

### Catatan: cross-check Remix ≠ contract Sepolia ini

Key contoh di cross-check Remix (`0x31e5891f…4763f`, donasi
`11111111-1111-4111-8111-111111111111`) **tidak ada** di contract Sepolia ini:
`verify` = `0x000…0` dan `isNotarized` = `false`. Cross-check Remix dijalankan di
deployment terpisah (kemungkinan Remix VM), jadi bukti Remix dan bukti Sepolia di dokumen
ini adalah dua bukti yang independen. Kecocokan format canonical-nya dikunci oleh test
vector #2/#3 di `packages/shared/src/canonical.test.ts`.

Mencocokkan event #1–#16 dengan donasi di DB (UUID → key) memerlukan akses DB
(`BlockchainTransaction.onchainKey`). Langkah ini **tidak** dilakukan di sini karena
pengumpulan bukti ini sengaja tidak menyentuh database.

## Cara mereproduksi

Dari root repo, tanpa `.env` dan tanpa key apa pun:

```bash
pnpm install
cd contracts
npx ts-node scripts/collect-evidence.ts
# opsional: simpan JSON lengkap
EVIDENCE_JSON=evidence.json npx ts-node scripts/collect-evidence.ts
```

PowerShell:

```powershell
cd contracts
$env:EVIDENCE_JSON = "evidence.json"; npx ts-node scripts/collect-evidence.ts
```

Detail script [`contracts/scripts/collect-evidence.ts`](../../../contracts/scripts/collect-evidence.ts):

- Memakai `ethers.JsonRpcProvider` langsung dan **tidak** meng-import `hardhat`, sehingga
  `hardhat.config.ts`/dotenv (yang memuat `DEPLOYER_PRIVATE_KEY`) tidak ikut dijalankan.
- Default RPC adalah `https://sepolia.gateway.tenderly.co` (publik, tanpa key).
  `https://ethereum-sepolia-rpc.publicnode.com` **tidak bisa** dipakai untuk `eth_getLogs`
  histori lama karena menolak dengan error `4444 pruned history unavailable`. RPC lain bisa
  dipilih lewat `EVIDENCE_RPC_URL`.
- `eth_getLogs` dipecah per 10.000 blok (`EVIDENCE_CHUNK`). Kalau RPC menolak, ukuran chunk
  dibagi dua otomatis.
- Output: jumlah event, saldo relayer, status role, tabel Markdown, dan hasil `verify` untuk
  event pertama/tengah/terakhir.

Cek satu key secara manual (Foundry `cast`, opsional):

```bash
cast call 0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2 "verify(bytes32)(bytes32)" \
  0x1db2b50a1f3c083cc45fbf3c623d29e99e4f82fc6a95d5e19c238fa08c89619a \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
# -> 0x6fc43a3469d0c416d18261dc9c9cd11846c856a1de9e0155635747765305dd15
```

Monitor saldo relayer yang sudah ada: `pnpm --filter @fundchain/contracts monitor:relayer`
(read-only).

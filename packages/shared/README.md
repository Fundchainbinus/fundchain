# @fundchain/shared

Kode bersama untuk `apps/api`, `apps/web`, dan tooling blockchain: konstanta, error,
dan **format canonical payload donasi** (`src/canonical.ts`).

```bash
pnpm --filter @fundchain/shared test       # vitest, termasuk test vector beku
pnpm --filter @fundchain/shared typecheck
pnpm --filter @fundchain/shared build      # tsup -> dist/ (ESM + CJS + d.ts)
```

---

## Spesifikasi canonical payload v1 (BFD-26)

`src/canonical.ts` adalah **satu-satunya** sumber format hash donasi. Fungsi yang sama
dipakai di tiga tempat, sehingga hasilnya harus identik byte per byte:

| Pemakai | File | Kapan |
| --- | --- | --- |
| Settlement pembayaran | `apps/api/src/modules/payments/payments.service.ts` | Saat donasi `PAID`: hitung `payload` + `hash`, simpan di DB, antrekan notarisasi dengan `onchainKey` |
| Notarization worker | `apps/api/src/modules/blockchain/*` | Kirim `notarize(onchainKey, hash)` ke `DonationRegistry` |
| Integrity checker | `apps/api/src/modules/integrity/integrity.service.ts` | Bangun ulang hash dari data DB **saat ini** lalu bandingkan dengan `verify(onchainKey)` |

### Format

```text
v1|<donationId>|<integritySubjectId>|<amount>|<unixTs>
```

Lima field, dipisah karakter `|` (U+007C), tanpa spasi tambahan, tanpa newline di akhir.

| # | Field | Sumber | Aturan normalisasi | Validasi |
| --- | --- | --- | --- | --- |
| 1 | prefix versi | konstanta `CANONICAL_VERSION` | selalu string literal `v1` | — |
| 2 | `donationId` | `Donation.id` (UUID) | di-`toLowerCase()` | wajib tidak kosong, tidak boleh mengandung `\|` |
| 3 | `integritySubjectId` | `Donor.integritySubjectId` (pseudonim, mis. `STU-00042`) | **apa adanya**: case-sensitive, tidak di-trim | wajib tidak kosong, tidak boleh mengandung `\|` |
| 4 | `amount` | nominal rupiah (integer) | `BigInt(amount).toString()`: desimal basis 10, tanpa pemisah ribuan, tanpa leading zero | `number` harus `Number.isInteger`, `NaN` ditolak; `bigint` diterima apa adanya |
| 5 | `unixTs` | `donatedAt` yang **tersimpan di DB** (bukan `now()`) | detik Unix: `Math.floor(ms / 1000)`; milidetik dibuang | — |

Catatan per field:

- `donatedAt` boleh `Date` atau `number`. **`number` diartikan milidetik** (seperti
  `Date.getTime()`), bukan detik. Karena milidetik dibuang, `12:53:20.000Z` dan
  `12:53:20.789Z` menghasilkan hash yang sama. API memanggil `floorToSecond()` sebelum
  menyimpan supaya nilai DB dan hash konsisten.
- `integritySubjectId` sengaja pseudonim. **Jangan** memakai email atau nama, karena
  payload ikut tersimpan di DB dan dipakai sebagai bukti audit.
- `amount` dalam satuan rupiah penuh (integer, tanpa sen).

### Encoding & hashing

```text
hash = keccak256( UTF-8(payload) )        // 0x + 64 hex lowercase (bytes32)
```

- Payload di-encode UTF-8 (`ethers.toUtf8Bytes`), tanpa normalisasi Unicode tambahan.
- Hash = Keccak-256 versi Ethereum (bukan SHA3-256 NIST), sama dengan
  `keccak256(bytes(payload))` di Solidity/Remix.
- Fungsi: `hashPayload(payload)`, atau `hashDonation(input)` yang mengembalikan
  `{ payload, hash }`.

### Derivasi key on-chain

Contract `DonationRegistry` menyimpan `mapping(bytes32 => Record)`. Key-nya **bukan**
UUID mentah, melainkan:

```text
onchainKey = keccak256( UTF-8( lowercase(donationId) ) )
```

- Fungsi: `toOnchainKey(donationId)`. Hasilnya tidak tergantung huruf besar/kecil UUID.
- Key disimpan di DB (`BlockchainTransaction.onchainKey`, kolom `onchain_key`) dan tidak dibalik (one-way). Untuk
  mencari donasi dari event on-chain, cocokkan key dengan kolom tersebut.
- Event `DonationNotarized(bytes32 indexed donationId, bytes32 hash, ...)`: argumen
  `donationId` di event adalah `onchainKey` ini.

### Verifikasi manual (Remix / Etherscan)

1. Hitung `onchainKey` dan `hash` dengan `hashDonation()` / `toOnchainKey()`, atau lihat
   test vector di bawah.
2. Panggil `verify(onchainKey)` di contract (tab *Read Contract* Etherscan atau Remix).
3. `verify` == `hash` berarti data DB utuh. Kalau beda, berarti data DB berubah setelah
   notarisasi (TAMPERED). Kalau `0x000…0`, donasi belum dinotarisasi.

### Test vector beku (frozen)

Nilai ini dikunci di `src/canonical.test.ts` (`FROZEN_VECTORS`). Implementasi lain
(mis. script Python/Go untuk auditor) **harus** menghasilkan nilai yang sama.

| # | Input | Payload | Hash | onchainKey |
| --- | --- | --- | --- | --- |
| 1 | `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`, `STU-00042`, `100000`, `2026-09-28T12:53:20.789Z` | `v1\|a1b2c3d4-e5f6-7890-abcd-ef1234567890\|STU-00042\|100000\|1790600000` | `0x5bbb0fe554a82b0e941129cc588d7f36b5d099bd94a168210f5c84b17e1399be` | `0x98c2d0d0dc0589b23b6f69fbee093a3dc1613579ed1dbe75a3eec3da944bac2b` |
| 2 | `11111111-1111-4111-8111-111111111111`, `STU-00042`, `50000`, `2026-10-04T12:00:00Z` | `v1\|11111111-1111-4111-8111-111111111111\|STU-00042\|50000\|1791115200` | `0x3a0adf185d40527d1996cd26f4613ef0d6f1af1211474bf84fcda19a6d058dd2` | `0x31e5891f6803041a37cfae842c5bf47aa89df5130d6a8ba235cdd9041744763f` |
| 3 | sama dengan #2, `amount` = `90000` (tamper) | `v1\|11111111-1111-4111-8111-111111111111\|STU-00042\|90000\|1791115200` | `0x39d0d37687d36d382c87699a9d97e23d97f0efc1cb3b476090e4e1750aea96b3` | `0x31e5891f6803041a37cfae842c5bf47aa89df5130d6a8ba235cdd9041744763f` |
| 4 | `9f8e7d6c-5b4a-4321-8fed-cba987654321`, `DNR-7`, `12345678901234567890n` (bigint), `0` (number, ms) | `v1\|9f8e7d6c-5b4a-4321-8fed-cba987654321\|DNR-7\|12345678901234567890\|0` | `0xc45dd3e9becfb85317c1da724fdb4503dc667a2884d234c1e265586036246675` | `0xd255be87bc8cc0997f15c26a63efbbe072112075dedd7348c7b225a88ba94fde` |

Vector #2 dan #3 sama persis dengan cross-check Remix di
[`docs/blockchain/remix-crosscheck-and-work-allocation.md`](../../docs/blockchain/remix-crosscheck-and-work-allocation.md)
(MATCH / MISMATCH). Sanity check: `hashPayload('')` =
`0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470` (keccak256 string kosong).

### Versi: `'v1'` vs `CANONICAL_VERSION = 1`

Dokumen spesifikasi awal menulis `CANONICAL_VERSION=1`, sedangkan kode memakai string
`'v1'`. **Keputusan: keduanya berarti hal yang sama.** Prefix payload `v1` adalah
representasi tekstual dari versi canonical 1.

- Nilai runtime **tidak diubah** menjadi `1`/`'1'`. Prefix ini ikut di-hash, jadi
  mengubahnya akan mengubah semua hash. Seluruh notarisasi yang sudah ada di Sepolia
  (lihat `docs/blockchain/evidence/SEPOLIA-E2E.md`) akan langsung terbaca TAMPERED.
- Test `prefix versi runtime tetap "v1"` mengunci keputusan ini.

### Aturan versioning

1. **v1 beku.** Format, normalisasi, dan encoding v1 tidak boleh diubah, sekecil apa pun
   (termasuk menambah `trim()`, mengubah lowercase, atau mengganti satuan waktu).
   Test vector di atas tidak boleh di-update agar test hijau.
2. Perubahan format = versi baru (`v2|...`), dengan prefix berbeda. Kode verifikasi harus
   membaca prefix dari payload yang tersimpan di DB, lalu memilih builder yang sesuai,
   sehingga donasi v1 lama tetap diverifikasi dengan aturan v1.
3. Versi baru wajib menambah test vector beku sendiri dan memperbarui dokumen ini.
4. Perubahan file ini adalah kontrak lintas tim (worker, integrity checker, contract):
   PR wajib direview ketiga area.

### Batasan v1 yang diketahui (didokumentasikan, tidak diubah)

Perilaku berikut adalah perilaku v1 saat ini. Validasi tambahan dilakukan di layer API
(DTO/DB), **bukan** di builder, karena mengubah builder berarti mengubah v1.

| Input | Perilaku v1 |
| --- | --- |
| `amount` negatif (`-5`) | diterima, payload `...\|-5\|...` |
| `amount` `number` > 2^53 | presisi sudah hilang sebelum `BigInt()`. Pakai `bigint` untuk nominal besar |
| `donatedAt` `Invalid Date` | payload berisi `NaN` (tidak dilempar error) |
| `donationId` bukan UUID | diterima (hanya di-lowercase) |
| spasi di `integritySubjectId` | dipertahankan, tidak di-trim |
| karakter non-ASCII | diterima, di-hash sebagai UTF-8 |

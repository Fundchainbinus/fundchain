# Log Keputusan (Decision Log)

Keputusan implementasi yang menyimpang dari, atau melengkapi, dokumen di `FundChain_Complete_Planning_Docs/`.
Ringkasannya juga ada di tabel _Keputusan implementasi vs dokumen planning_ di `README.md`.

Format: konteks → keputusan → konsekuensi. Entri baru ditambahkan di bawah; entri lama tidak diedit,
melainkan diganti dengan entri baru yang menyebut entri yang digantikan.

---

## D-001 — Kebijakan refund donasi (BFD-75)

**Status:** diterima · **Kode:** `apps/api/src/modules/payments/payments.service.ts` (`refund`, `assertRefundable`,
`assertCampaignFrozen`), endpoint `POST /api/v1/admin/donations/:id/refund` (`donations.controller.ts`, `@Roles('ADMIN')`).

### Konteks

Setiap donasi PAID punya canonical payload + hash yang dinotarisasi ke blockchain. Bukti on-chain itu
permanen dan tidak bisa diubah. Pakasir (gateway saat kebijakan ini dibuat) tidak punya API refund, jadi
uang tidak bisa dikembalikan otomatis. Refund dibutuhkan terutama saat campaign dibekukan (FROZEN) karena
masalah integritas atau laporan penyalahgunaan.

### Keputusan

1. **Manual.** Refund dicatat oleh admin; uangnya dikembalikan ke donatur **di luar sistem** (transfer manual).
   Sistem hanya mencatat status dan mengoreksi saldo.
2. **Hanya donasi PAID.** Donasi PENDING/FAILED/EXPIRED/REFUNDED ditolak (`DONATION_NOT_REFUNDABLE`).
   Refund kedua untuk donasi yang sama juga ditolak karena status sudah REFUNDED (guard atomik `updateMany ... status: 'PAID'`).
3. **Hanya campaign FROZEN.** Di campaign ACTIVE/COMPLETED (dan status lain) refund ditolak
   (`REFUND_CAMPAIGN_NOT_FROZEN`). Status campaign dicek di dalam transaksi setelah baris campaign dikunci.
4. **Admin saja, wajib alasan.** Endpoint dijaga `@Roles('ADMIN')`; `reason` wajib 5–500 karakter.
5. **Penuh, dibatasi saldo bebas.** Refund selalu sebesar nominal donasi (tidak ada refund sebagian) dan tidak boleh
   melebihi `currentAmount` dikurangi pencairan yang sudah terikat (REQUESTED/APPROVED/PAID); bila kurang →
   `REFUND_EXCEEDS_AVAILABLE`, dan pencairan terkait harus ditolak/diselesaikan dulu.
6. **Catatan notaris tidak disentuh.** Refund adalah **status baru + entri audit**, bukan edit catatan yang
   dinotarisasi. `hash`, `canonicalPayload`, `donatedAt`, dan baris `blockchain_transactions` tetap seperti semula;
   tidak ada transaksi on-chain baru. Yang berubah hanya: `donations.status` → REFUNDED,
   `payments.status` → REFUNDED, `campaigns.current_amount` dikurangi nominal donasi.
7. **Audit.** Satu entri `DONATION_REFUNDED` dengan `actorId` admin, IP, alasan, nominal, status & alasan freeze
   campaign, hash donasi, dan status on-chain saat refund. Semua langkah di atas berjalan dalam satu transaksi
   (gagal di tengah = rollback penuh).

### Konsekuensi

- Integrity checker hanya memverifikasi donasi PAID, sehingga donasi REFUNDED tidak terdeteksi TAMPERED walaupun
  hash-nya masih tercatat on-chain. Bukti on-chain tetap membuktikan bahwa donasi itu pernah dibayar.
- Bukti pengembalian dana (mis. bukti transfer) belum disimpan sistem; admin menyimpannya di luar sistem dan
  merujuknya di `reason`.
- Webhook SETTLED yang datang lagi setelah refund diperlakukan sebagai replay dan tidak menghidupkan donasi kembali
  (pembayaran REFUNDED dianggap final di `applyEvent`).

---

## D-002 — Payment gateway: Pakasir → Sakurupiah (BFD-107 – BFD-111)

**Status:** diterima, implementasi berjalan.

### Konteks

Integrasi awal memakai adapter `pakasir` (QRIS) di samping adapter `mock`.

### Keputusan

- Tim pindah dari Pakasir ke gateway **Sakurupiah**; pekerjaannya ada di BFD-107 sampai BFD-111.
- Adapter `pakasir` tidak dikembangkan lagi.

### Pertanyaan terbuka

- Kapan adapter `pakasir` dihapus dari kode.
- Apakah Sakurupiah punya API refund, dan apakah D-001 (refund manual di luar sistem) perlu ditinjau ulang.
  Sampai ada keputusan baru, D-001 tetap berlaku.

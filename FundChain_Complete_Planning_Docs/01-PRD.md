# FundChain --- Product Requirements Document

## 1. Product Overview

FundChain adalah platform fundraising mahasiswa berbasis web yang
menggunakan blockchain sebagai immutable proof layer untuk transparansi
dan verifikasi integritas data donasi.

Data aplikasi tetap disimpan secara off-chain. Blockchain digunakan
untuk menyimpan fingerprint/hash transaksi donasi sehingga perubahan
data setelah notarization dapat dideteksi.

## 2. Goals

-   Mempermudah mahasiswa membuat dan mengajukan campaign.
-   Memastikan campaign melewati review admin BINUS.
-   Mendukung donasi fiat melalui payment gateway.
-   Menyediakan bukti transaksi berbasis blockchain.
-   Mendeteksi perubahan data donasi.
-   Mengunci pencairan jika integritas campaign bermasalah.

## 3. Scope

### In Scope

-   BINUS Microsoft SSO
-   Student/Admin RBAC
-   Campaign submission
-   Proposal upload
-   Admin review
-   Campaign catalog
-   Donation
-   Payment gateway
-   Webhook settlement
-   Keccak-256 hashing
-   Blockchain relayer
-   Ethereum Sepolia
-   Integrity checker
-   Tamper detection
-   Auto-freeze
-   Disbursement approval
-   Audit log

### Out of Scope

-   Crypto donation
-   On-chain storage dokumen
-   Automatic bank transfer dari smart contract
-   Decentralized identity
-   DAO governance

## 4. User Roles

-   Student/Creator
-   Student/Donor
-   Admin BINUS

## 5. Success Criteria

-   Campaign hanya aktif setelah approval.
-   Donation yang settled tercatat sebagai PAID.
-   PAID donation dapat dinotarize ke Sepolia.
-   Hash dapat diverifikasi ulang.
-   Manipulasi data menghasilkan TAMPERED.
-   Campaign TAMPERED menjadi FROZEN.
-   FROZEN campaign tidak dapat dicairkan.

## 6. Functional Requirements

### Authentication

-   Login Microsoft BINUS SSO.
-   Email harus @binus.ac.id.
-   Tidak ada registrasi manual.
-   Role ditentukan backend.

### Campaign

Field: - title - description - SDG category - target amount - deadline -
proposal - status

### Review

-   Admin melihat PENDING_REVIEW.
-   Approve → ACTIVE.
-   Reject → REJECTED + reason.
-   Rejected campaign dapat direvisi.

### Donation

-   Hanya ACTIVE campaign yang menerima donation.
-   Payment melalui QRIS/VA.
-   Webhook settlement diverifikasi.
-   Donation menjadi PAID.

### Blockchain

-   Generate canonical payload.
-   Keccak-256.
-   Submit hash melalui relayer.
-   Simpan txHash.

### Integrity

-   Recalculate hash dari database.
-   Read hash on-chain.
-   Match → VERIFIED.
-   Mismatch → TAMPERED.
-   TAMPERED → FROZEN.

### Disbursement

-   Creator request.
-   Upload milestone/proof.
-   Admin review.
-   Approved → paid through campus fund process.
-   FROZEN → locked.

## 7. Non-Functional Requirements

-   Input validation.
-   Authentication and authorization.
-   Webhook idempotency.
-   Blockchain retry.
-   Auditability.
-   Secure file upload.
-   Secret management.

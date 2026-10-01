# Business Rules

## Authentication

BR-AUTH-001 --- Hanya akun @binus.ac.id yang dapat login.

BR-AUTH-002 --- Role tidak boleh ditentukan dari request frontend.

BR-AUTH-003 --- Admin endpoint wajib menggunakan backend authorization.

## Campaign

BR-CAM-001 --- Campaign baru berstatus DRAFT atau langsung
PENDING_REVIEW setelah submit.

BR-CAM-002 --- Campaign harus memiliki target amount \> 0.

BR-CAM-003 --- Deadline harus berada di masa depan saat submission.

BR-CAM-004 --- Proposal wajib tersedia sebelum submission.

BR-CAM-005 --- Hanya ACTIVE campaign yang boleh menerima donation.

BR-CAM-006 --- REJECTED campaign dapat direvisi dan dikirim kembali.

BR-CAM-007 --- FROZEN campaign tidak boleh menerima proses disbursement.

## Review

BR-REV-001 --- Reject wajib memiliki rejection reason.

BR-REV-002 --- Hanya Admin yang dapat approve/reject.

BR-REV-003 --- Setiap keputusan review masuk audit log.

## Donation

BR-DON-001 --- Nominal donation harus \> 0.

BR-DON-002 --- Amount final harus berasal dari server/payment gateway,
bukan frontend.

BR-DON-003 --- Webhook harus diverifikasi.

BR-DON-004 --- Webhook harus idempotent.

BR-DON-005 --- Donation PAID tidak boleh diproses menjadi PAID lagi.

## Blockchain

BR-BC-001 --- Hanya donation PAID yang boleh dinotarize.

BR-BC-002 --- Satu donation hanya boleh memiliki satu notarization
canonical.

BR-BC-003 --- Private key relayer tidak boleh exposed ke frontend.

BR-BC-004 --- Blockchain failure tidak boleh mengubah PAID menjadi
unpaid.

BR-BC-005 --- Blockchain job harus dapat retry.

## Integrity

BR-INT-001 --- Hash generation harus deterministic.

BR-INT-002 --- Hash database dibandingkan dengan hash on-chain.

BR-INT-003 --- Mismatch menghasilkan TAMPERED.

BR-INT-004 --- TAMPERED campaign otomatis FROZEN.

BR-INT-005 --- FROZEN campaign mengunci disbursement.

## Disbursement

BR-DIS-001 --- Hanya creator campaign yang dapat mengajukan
disbursement.

BR-DIS-002 --- Bukti milestone/rencana penggunaan dana wajib.

BR-DIS-003 --- Admin harus approve sebelum transfer.

BR-DIS-004 --- FROZEN campaign tidak dapat dicairkan.

BR-DIS-005 --- Semua keputusan disbursement masuk audit log.

# Competition Demo Flow

## 1. Login

Login menggunakan Microsoft BINUS.

## 2. Create Campaign

Student membuat campaign dengan: - title - SDG - target - deadline -
proposal

Status: `PENDING_REVIEW`

## 3. Admin Review

Admin membuka queue dan approve.

Status: `ACTIVE`

## 4. Donation

Donor membuka campaign dan melakukan donation.

Payment: `QRIS / VA`

Webhook: `SETTLED`

Donation: `PAID`

## 5. Blockchain

Backend: - generate canonical payload - Keccak-256 - queue job - relayer
submit - save txHash

## 6. Transparency

Tampilkan: - donation - amount - verification status - txHash - Sepolia
explorer

Status: `VERIFIED`

## 7. Tamper Simulation

Ubah data donation di testing environment.

Example: `Rp100.000 → Rp900.000`

Run integrity checker.

Expected: `TAMPERED`

System: `Campaign → FROZEN`

Disbursement: `LOCKED`

## 8. Disbursement

Untuk campaign normal: - creator request - upload proof - admin
approve - mark payment process

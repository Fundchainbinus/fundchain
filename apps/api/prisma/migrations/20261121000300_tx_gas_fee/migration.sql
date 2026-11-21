-- BFD-92: monitoring biaya gas notarisasi. Additive saja: kolom nullable, tanpa default, tanpa index.
-- Diisi worker saat tx CONFIRMED dari receipt (gasUsed, effectiveGasPrice); fee_wei = gas_used * effective_gas_price.
-- DECIMAL(78,0) cukup untuk uint256 (wei) tanpa kehilangan presisi.
ALTER TABLE "blockchain_transactions" ADD COLUMN IF NOT EXISTS "gas_used" DECIMAL(78,0);
ALTER TABLE "blockchain_transactions" ADD COLUMN IF NOT EXISTS "effective_gas_price" DECIMAL(78,0);
ALTER TABLE "blockchain_transactions" ADD COLUMN IF NOT EXISTS "fee_wei" DECIMAL(78,0);

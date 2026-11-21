import { runRoleScript } from './lib/relayer-role';

/**
 * BFD-29 — grant RELAYER_ROLE ke wallet relayer baru. Dijalankan oleh pemegang wallet ADMIN.
 *
 *   NEW_RELAYER_ADDRESS=0x... npx hardhat run scripts/grant-relayer.ts --network sepolia
 *
 * Env:
 *   NEW_RELAYER_ADDRESS  wajib — wallet yang diberi role
 *   REGISTRY_ADDRESS     opsional — default `address` di deployments/<network>.json
 *   DEPLOYER_PRIVATE_KEY wallet admin (dibaca hardhat.config.ts dari contracts/.env)
 *
 * Mengecek hasRole sebelum & sesudah, mencetak tx hash, dan tidak mengirim tx kalau
 * wallet sudah punya role. Lihat docs/blockchain/RELAYER-ROLE-RUNBOOK.md.
 */
runRoleScript('grant', 'NEW_RELAYER_ADDRESS').catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

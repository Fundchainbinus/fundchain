import { runRoleScript } from './lib/relayer-role';

/**
 * BFD-30 — revoke RELAYER_ROLE dari wallet relayer lama / bocor. Dijalankan oleh pemegang wallet ADMIN.
 *
 *   OLD_RELAYER_ADDRESS=0x... npx hardhat run scripts/revoke-relayer.ts --network sepolia
 *
 * Env:
 *   OLD_RELAYER_ADDRESS  wajib — wallet yang dicabut role-nya
 *   REGISTRY_ADDRESS     opsional — default `address` di deployments/<network>.json
 *   DEPLOYER_PRIVATE_KEY wallet admin (dibaca hardhat.config.ts dari contracts/.env)
 *
 * PERHATIAN: setelah revoke, backend yang masih memakai key lama akan gagal notarize
 * (AccessControlUnauthorizedAccount). Pastikan relayer baru sudah di-grant dan
 * RELAYER_PRIVATE_KEY di Vercel sudah diganti. Lihat docs/blockchain/RELAYER-ROLE-RUNBOOK.md.
 */
runRoleScript('revoke', 'OLD_RELAYER_ADDRESS').catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

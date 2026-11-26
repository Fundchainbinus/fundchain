# Jaringan privat Binusian (Hyperledger Besu, QBFT)

Pengganti Sepolia publik untuk notarisasi donasi FundChain (D-013). **Belum dijalankan/diuji**:
file ini disiapkan tanpa Docker yang aktif. Uji di server staging dulu.

## Kenapa QBFT

- 4 validator milik BINUS, toleran 1 node mati; blok final (tidak ada reorg), blok tiap 2 detik.
- Gas price 0: relayer tidak perlu membeli ETH testnet. Saldo awal deployer/relayer diisi di genesis.
- EVM kompatibel: `DonationRegistry` dan API tidak berubah, cukup env.

## Langkah (oleh tim infra / BINUS IT)

1. Siapkan server (atau 4 VM) dengan Docker. Buat dua wallet: admin contract (deployer) dan relayer.
2. `DEPLOYER_ADDRESS=0x… RELAYER_ADDRESS=0x… ./generate.sh` — membuat `config/genesis.json`, kunci validator
   `node1..4/key` (**rahasia**, sudah di `.gitignore`), dan `.env` berisi bootnode.
3. `docker compose up -d`, lalu cek: `curl -s -X POST localhost:8545 -H 'content-type: application/json'
   -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` — nomor blok harus naik.
4. Deploy contract: di `contracts/.env` isi `DEPLOYER_PRIVATE_KEY`, `RELAYER_ADDRESS`, `BINUSIAN_RPC_URL`,
   lalu `pnpm --filter @fundchain/contracts deploy:binusian` → `contracts/deployments/binusian.json`.
5. Ekspos RPC node1 ke API FundChain lewat VPN/reverse proxy kampus dengan autentikasi (jangan RPC terbuka ke internet).
6. Ganti env API (Vercel): `BLOCKCHAIN_NETWORK=binusian`, `CHAIN_ID=2026`, `BLOCKCHAIN_RPC_URL=<rpc>`,
   `CONTRACT_ADDRESS=<dari binusian.json>`, `RELAYER_PRIVATE_KEY=<relayer>`, `BLOCKCHAIN_CONFIRMATIONS=1`
   (QBFT final), opsional `BLOCKCHAIN_EXPLORER_URL` bila memasang Blockscout. Redeploy.
7. Verifikasi: donasi baru → CONFIRMED di chain baru; donasi lama (Sepolia) → halaman bukti masih VERIFIED.

Bila Besu menolak `cancunTime` di genesis, hapus baris itu dan kompilasi ulang contract dengan `evmVersion: 'paris'`
sebelum deploy.

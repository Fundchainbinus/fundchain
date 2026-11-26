#!/usr/bin/env sh
# Membuat genesis + kunci 4 validator QBFT untuk jaringan privat Binusian.
#   DEPLOYER_ADDRESS=0x... RELAYER_ADDRESS=0x... ./generate.sh
# Hasil: ./config/genesis.json, ./node1..node4/key (RAHASIA, jangan di-commit), ./.env (BOOTNODE).
set -eu
cd "$(dirname "$0")"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:24.10.0}"
: "${DEPLOYER_ADDRESS:?isi DEPLOYER_ADDRESS (wallet admin contract)}"
: "${RELAYER_ADDRESS:?isi RELAYER_ADDRESS (wallet relayer API)}"

rm -rf build config node1 node2 node3 node4
mkdir -p build config
# Alamat tanpa 0x, huruf kecil: format alloc genesis.
dep=$(printf '%s' "$DEPLOYER_ADDRESS" | sed 's/^0x//' | tr 'A-F' 'a-f')
rel=$(printf '%s' "$RELAYER_ADDRESS" | sed 's/^0x//' | tr 'A-F' 'a-f')
sed -e "s/__DEPLOYER_ADDRESS__/$dep/" -e "s/__RELAYER_ADDRESS__/$rel/" qbftConfigFile.json > build/qbftConfigFile.json

docker run --rm -v "$PWD/build:/build" "$BESU_IMAGE" operator generate-blockchain-config \
  --config-file=/build/qbftConfigFile.json --to=/build/networkFiles --private-key-file-name=key

cp build/networkFiles/genesis.json config/genesis.json
i=1
for dir in build/networkFiles/keys/*; do
  mkdir -p "node$i"
  cp "$dir/key" "$dir/key.pub" "node$i/"
  i=$((i + 1))
done
pub=$(sed 's/^0x//' node1/key.pub)
printf 'BOOTNODE=enode://%s@172.16.240.11:30303\n' "$pub" > .env
echo "Selesai. Jalankan: docker compose up -d   (RPC: http://127.0.0.1:8545, chainId 2026)"

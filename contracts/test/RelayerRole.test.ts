import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { changeRelayerRole, requireAddress, resolveRegistryAddress } from '../scripts/lib/relayer-role';

/**
 * BFD-29/30 — rotasi RELAYER_ROLE, dites dengan kode yang SAMA dengan
 * scripts/grant-relayer.ts & scripts/revoke-relayer.ts (scripts/lib/relayer-role.ts).
 */
async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('promise seharusnya reject');
}

describe('Rotasi RELAYER_ROLE (grant/revoke)', () => {
  async function deployFixture() {
    const [admin, oldRelayer, stranger] = await ethers.getSigners();
    // Wallet relayer BARU yang belum pernah ada di kontrak.
    const newRelayer = ethers.Wallet.createRandom().connect(ethers.provider);
    await admin.sendTransaction({ to: newRelayer.address, value: ethers.parseEther('1') });
    const Registry = await ethers.getContractFactory('DonationRegistry');
    const registry = await Registry.deploy(admin.address, oldRelayer.address);
    const role = await registry.RELAYER_ROLE();
    const id = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
    return { registry, admin, oldRelayer, newRelayer, stranger, role, id };
  }

  it('admin grant RELAYER_ROLE ke wallet baru → wallet itu bisa notarize', async () => {
    const { registry, admin, newRelayer, role, id } = await loadFixture(deployFixture);
    expect(await registry.hasRole(role, newRelayer.address)).to.equal(false);
    await expect(registry.connect(newRelayer).notarize(id('d-1'), id('h-1'))).to.be.revertedWithCustomError(
      registry,
      'AccessControlUnauthorizedAccount',
    );

    const res = await changeRelayerRole('grant', registry, admin, newRelayer.address);
    expect(res.before).to.equal(false);
    expect(res.after).to.equal(true);
    expect(res.txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(await ethers.provider.getTransactionReceipt(res.txHash!)).to.not.equal(null);

    await expect(registry.connect(newRelayer).notarize(id('d-1'), id('h-1')))
      .to.emit(registry, 'DonationNotarized')
      .withArgs(id('d-1'), id('h-1'), (t: bigint) => t > 0n, newRelayer.address);
    expect(await registry.verify(id('d-1'))).to.equal(id('h-1'));
  });

  it('grant memancarkan RoleGranted dengan sender = admin', async () => {
    const { registry, admin, newRelayer, role } = await loadFixture(deployFixture);
    const res = await changeRelayerRole('grant', registry, admin, newRelayer.address);
    const receipt = await ethers.provider.getTransactionReceipt(res.txHash!);
    const parsed = receipt!.logs.map((l) => registry.interface.parseLog(l)).find((l) => l?.name === 'RoleGranted');
    expect(parsed?.args.role).to.equal(role);
    expect(parsed?.args.account).to.equal(newRelayer.address);
    expect(parsed?.args.sender).to.equal(admin.address);
  });

  it('setelah revoke, wallet itu tidak bisa notarize lagi', async () => {
    const { registry, admin, newRelayer, id } = await loadFixture(deployFixture);
    await changeRelayerRole('grant', registry, admin, newRelayer.address);
    await registry.connect(newRelayer).notarize(id('d-1'), id('h-1'));

    const res = await changeRelayerRole('revoke', registry, admin, newRelayer.address);
    expect(res.before).to.equal(true);
    expect(res.after).to.equal(false);
    expect(res.txHash).to.match(/^0x[0-9a-f]{64}$/);

    await expect(registry.connect(newRelayer).notarize(id('d-2'), id('h-2')))
      .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
      .withArgs(newRelayer.address, await registry.RELAYER_ROLE());
    // Data yang sudah dinotarisasi tidak hilang karena revoke.
    expect(await registry.verify(id('d-1'))).to.equal(id('h-1'));
  });

  it('rotasi penuh: grant baru → revoke lama → hanya relayer baru yang bisa notarize', async () => {
    const { registry, admin, oldRelayer, newRelayer, role, id } = await loadFixture(deployFixture);
    await changeRelayerRole('grant', registry, admin, newRelayer.address);
    await changeRelayerRole('revoke', registry, admin, oldRelayer.address);
    expect(await registry.hasRole(role, oldRelayer.address)).to.equal(false);
    expect(await registry.hasRole(role, newRelayer.address)).to.equal(true);
    await expect(registry.connect(oldRelayer).notarize(id('d-x'), id('h-x'))).to.be.revertedWithCustomError(
      registry,
      'AccessControlUnauthorizedAccount',
    );
    await registry.connect(newRelayer).notarize(id('d-x'), id('h-x'));
    expect((await registry.getRecord(id('d-x'))).notarizedBy).to.equal(newRelayer.address);
  });

  it('non-admin tidak bisa grant (langsung ke kontrak)', async () => {
    const { registry, stranger, oldRelayer, newRelayer, role } = await loadFixture(deployFixture);
    const adminRole = await registry.DEFAULT_ADMIN_ROLE();
    for (const signer of [stranger, oldRelayer]) {
      await expect(registry.connect(signer).grantRole(role, newRelayer.address))
        .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
        .withArgs(signer.address, adminRole);
    }
    // Relayer pun tidak bisa memberi role ke dirinya / wallet lain, dan tidak bisa revoke.
    await expect(registry.connect(oldRelayer).revokeRole(role, oldRelayer.address)).to.be.revertedWithCustomError(
      registry,
      'AccessControlUnauthorizedAccount',
    );
    expect(await registry.hasRole(role, newRelayer.address)).to.equal(false);
  });

  it('script menolak signer non-admin sebelum mengirim tx', async () => {
    const { registry, stranger, newRelayer } = await loadFixture(deployFixture);
    const nonceBefore = await ethers.provider.getTransactionCount(stranger.address);
    expect(await rejection(changeRelayerRole('grant', registry, stranger, newRelayer.address))).to.match(
      /bukan pemegang DEFAULT_ADMIN_ROLE/,
    );
    expect(await ethers.provider.getTransactionCount(stranger.address)).to.equal(nonceBefore);
  });

  it('idempotent: grant ke wallet yang sudah relayer tidak mengirim tx', async () => {
    const { registry, admin, oldRelayer } = await loadFixture(deployFixture);
    const nonceBefore = await ethers.provider.getTransactionCount(admin.address);
    const res = await changeRelayerRole('grant', registry, admin, oldRelayer.address);
    expect(res.txHash).to.equal(null);
    expect(res.before).to.equal(true);
    expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(nonceBefore);
    const res2 = await changeRelayerRole('revoke', registry, admin, ethers.Wallet.createRandom().address);
    expect(res2.txHash).to.equal(null);
  });

  it('validasi input address', async () => {
    const { registry, admin } = await loadFixture(deployFixture);
    expect(await rejection(changeRelayerRole('grant', registry, admin, 'bukan-address'))).to.match(
      /address yang valid/,
    );
    expect(() => requireAddress(undefined, 'NEW_RELAYER_ADDRESS')).to.throw(/NEW_RELAYER_ADDRESS/);
    expect(resolveRegistryAddress('sepolia')).to.equal('0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2');
    expect(() => resolveRegistryAddress('tidak-ada')).to.throw(/tidak ada/);
  });
});

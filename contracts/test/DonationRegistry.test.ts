import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('DonationRegistry', () => {
  async function deployFixture() {
    const [admin, relayer, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('DonationRegistry');
    const registry = await Registry.deploy(admin.address, relayer.address);
    const id = ethers.keccak256(ethers.toUtf8Bytes('a1b2c3d4-e5f6-7890-abcd-ef1234567890'));
    const hash = ethers.keccak256(ethers.toUtf8Bytes('v1|a1b2c3d4|STU-00042|100000|1790600000'));
    return { registry, admin, relayer, stranger, id, hash };
  }

  it('relayer dan admin dipisah', async () => {
    const { registry, admin, relayer } = await loadFixture(deployFixture);
    const RELAYER_ROLE = await registry.RELAYER_ROLE();
    expect(await registry.hasRole(RELAYER_ROLE, relayer.address)).to.equal(true);
    expect(await registry.hasRole(RELAYER_ROLE, admin.address)).to.equal(false);
    expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
  });

  it('notarize menyimpan hash dan emit event', async () => {
    const { registry, relayer, id, hash } = await loadFixture(deployFixture);
    await expect(registry.connect(relayer).notarize(id, hash))
      .to.emit(registry, 'DonationNotarized')
      .withArgs(id, hash, (t: bigint) => t > 0n, relayer.address);
    expect(await registry.verify(id)).to.equal(hash);
    expect(await registry.isNotarized(id)).to.equal(true);
    const record = await registry.getRecord(id);
    expect(record.notarizedBy).to.equal(relayer.address);
  });

  it('revert AlreadyNotarized saat notarize ulang', async () => {
    const { registry, relayer, id, hash } = await loadFixture(deployFixture);
    await registry.connect(relayer).notarize(id, hash);
    await expect(registry.connect(relayer).notarize(id, ethers.ZeroHash.replace(/0$/, '1')))
      .to.be.revertedWithCustomError(registry, 'AlreadyNotarized')
      .withArgs(id);
  });

  it('revert ZeroHash', async () => {
    const { registry, relayer, id } = await loadFixture(deployFixture);
    await expect(registry.connect(relayer).notarize(id, ethers.ZeroHash)).to.be.revertedWithCustomError(
      registry,
      'ZeroHash',
    );
  });

  it('non-relayer (termasuk admin) ditolak', async () => {
    const { registry, admin, stranger, id, hash } = await loadFixture(deployFixture);
    for (const signer of [admin, stranger]) {
      await expect(registry.connect(signer).notarize(id, hash)).to.be.revertedWithCustomError(
        registry,
        'AccessControlUnauthorizedAccount',
      );
    }
  });

  it('admin bisa revoke relayer yang bocor', async () => {
    const { registry, admin, relayer, id, hash } = await loadFixture(deployFixture);
    await registry.connect(admin).revokeRole(await registry.RELAYER_ROLE(), relayer.address);
    await expect(registry.connect(relayer).notarize(id, hash)).to.be.revertedWithCustomError(
      registry,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('verify untuk id yang belum ada mengembalikan bytes32(0)', async () => {
    const { registry, id } = await loadFixture(deployFixture);
    expect(await registry.verify(id)).to.equal(ethers.ZeroHash);
    expect(await registry.isNotarized(id)).to.equal(false);
  });

  it('constructor menolak zero address', async () => {
    const [admin] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('DonationRegistry');
    await expect(Registry.deploy(admin.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Registry,
      'ZeroAddress',
    );
  });

  it('fuzz: id & hash acak selalu bisa diverifikasi', async () => {
    const { registry, relayer } = await loadFixture(deployFixture);
    for (let i = 0; i < 20; i++) {
      const id = ethers.hexlify(ethers.randomBytes(32));
      const hash = ethers.hexlify(ethers.randomBytes(32));
      await registry.connect(relayer).notarize(id, hash);
      expect(await registry.verify(id)).to.equal(hash);
    }
  });
});

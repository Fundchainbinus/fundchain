// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title DonationRegistry — immutable proof layer FundChain
/// @notice Menyimpan hash Keccak-256 canonical payload donasi. Data asli tetap off-chain.
contract DonationRegistry is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    struct Record {
        bytes32 hash;
        uint256 timestamp;
        address notarizedBy;
    }

    mapping(bytes32 => Record) private _records;

    event DonationNotarized(bytes32 indexed donationId, bytes32 hash, uint256 timestamp, address notarizedBy);

    error AlreadyNotarized(bytes32 donationId);
    error ZeroHash();
    error ZeroAddress();

    /// @param admin  wallet admin (cold) — pemegang DEFAULT_ADMIN_ROLE, bisa revoke relayer
    /// @param relayer wallet backend (hot) — satu-satunya yang boleh notarize
    constructor(address admin, address relayer) {
        if (admin == address(0) || relayer == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RELAYER_ROLE, relayer);
    }

    function notarize(bytes32 donationId, bytes32 hash) external onlyRole(RELAYER_ROLE) {
        if (hash == bytes32(0)) revert ZeroHash();
        if (_records[donationId].timestamp != 0) revert AlreadyNotarized(donationId);
        _records[donationId] = Record(hash, block.timestamp, msg.sender);
        emit DonationNotarized(donationId, hash, block.timestamp, msg.sender);
    }

    function verify(bytes32 donationId) external view returns (bytes32) {
        return _records[donationId].hash;
    }

    function getRecord(bytes32 donationId) external view returns (Record memory) {
        return _records[donationId];
    }

    function isNotarized(bytes32 donationId) external view returns (bool) {
        return _records[donationId].timestamp != 0;
    }
}

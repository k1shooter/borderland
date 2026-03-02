// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DeathRegistry
/// @notice Optional on-chain mirror for irreversible death-state events.
/// @dev Store only hashed identifiers. Never store raw IPs or raw device IDs on-chain.
contract DeathRegistry {
    address public owner;

    struct DeathRecord {
        uint256 timestamp;
        bytes32 fingerprintHash;
        bytes32 ipHash;
        bytes32 walletHash;
        string cardCode;
        string username;
    }

    mapping(bytes32 => bool) public deadFingerprint;
    mapping(bytes32 => bool) public deadIp;
    mapping(bytes32 => bool) public deadWallet;
    mapping(bytes32 => DeathRecord) public recordsByFingerprint;

    event MarkedDead(
        bytes32 indexed fingerprintHash,
        bytes32 indexed ipHash,
        bytes32 indexed walletHash,
        string username,
        string cardCode,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function markDead(
        bytes32 fingerprintHash,
        bytes32 ipHash,
        bytes32 walletHash,
        string calldata username,
        string calldata cardCode
    ) external onlyOwner {
        require(fingerprintHash != bytes32(0), "fingerprint required");
        deadFingerprint[fingerprintHash] = true;
        if (ipHash != bytes32(0)) deadIp[ipHash] = true;
        if (walletHash != bytes32(0)) deadWallet[walletHash] = true;

        recordsByFingerprint[fingerprintHash] = DeathRecord({
            timestamp: block.timestamp,
            fingerprintHash: fingerprintHash,
            ipHash: ipHash,
            walletHash: walletHash,
            cardCode: cardCode,
            username: username
        });

        emit MarkedDead(fingerprintHash, ipHash, walletHash, username, cardCode, block.timestamp);
    }

    function isDead(
        bytes32 fingerprintHash,
        bytes32 ipHash,
        bytes32 walletHash
    ) external view returns (bool) {
        return deadFingerprint[fingerprintHash] || deadIp[ipHash] || deadWallet[walletHash];
    }
}

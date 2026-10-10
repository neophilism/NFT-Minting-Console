// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NFTCollection} from "./NFTCollection.sol";

/// @notice Stateless CREATE2 deployment boundary for NFT Console releases.
/// @dev The factory never owns a collection, holds funds, or stores signing keys.
contract NFTCollectionFactory {
    bytes32 public constant FACTORY_VERSION = keccak256("nft-console.collection-factory.v2");
    bytes32 public constant COLLECTION_CREATION_CODE_ID = keccak256(type(NFTCollection).creationCode);

    struct CollectionConfig {
        string name;
        string symbol;
        uint256 seriesSize;
        uint96 royaltyBps;
        address owner;
        address minter;
        address royaltyRecipient;
    }

    // A release identifier is meaningful within its transaction sender's namespace.
    // Permissionless callers cannot reserve another wallet's deployment slot.
    mapping(address requester => mapping(bytes32 releaseId => address collection)) public collectionForRelease;

    error EmptyReleaseId();
    error DuplicateRelease(address requester, bytes32 releaseId, address collection);
    error EmptyValue();
    error InvalidSeriesSize();
    error InvalidRoyalty();
    error ZeroAddress();

    event CollectionDeployed(
        bytes32 indexed releaseId,
        address indexed collection,
        address indexed requester,
        uint256 chainId,
        bytes32 factoryVersion,
        bytes32 collectionCreationCodeId,
        bytes32 configHash,
        bytes32 initCodeHash
    );

    function deployCollection(
        bytes32 releaseId,
        CollectionConfig calldata config
    ) external returns (address collection) {
        _validate(releaseId, config);
        address existing = collectionForRelease[msg.sender][releaseId];
        if (existing != address(0)) revert DuplicateRelease(msg.sender, releaseId, existing);

        bytes32 salt = deploymentSalt(msg.sender, releaseId);
        bytes32 configHash = hashConfig(config);
        bytes32 initCodeHash = collectionInitCodeHash(config);
        collection = address(new NFTCollection{salt: salt}(
            config.name,
            config.symbol,
            config.seriesSize,
            config.royaltyBps,
            config.owner,
            config.minter,
            config.royaltyRecipient
        ));
        collectionForRelease[msg.sender][releaseId] = collection;

        emit CollectionDeployed(
            releaseId,
            collection,
            msg.sender,
            block.chainid,
            FACTORY_VERSION,
            COLLECTION_CREATION_CODE_ID,
            configHash,
            initCodeHash
        );
    }

    function predictCollectionAddress(
        address requester,
        bytes32 releaseId,
        CollectionConfig calldata config
    ) external view returns (address) {
        _validate(releaseId, config);
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            deploymentSalt(requester, releaseId),
            collectionInitCodeHash(config)
        )))));
    }

    function deploymentSalt(address requester, bytes32 releaseId) public view returns (bytes32) {
        if (requester == address(0)) revert ZeroAddress();
        return keccak256(abi.encode(FACTORY_VERSION, block.chainid, requester, releaseId));
    }

    function hashConfig(CollectionConfig calldata config) public pure returns (bytes32) {
        return keccak256(abi.encode(
            config.name,
            config.symbol,
            config.seriesSize,
            config.royaltyBps,
            config.owner,
            config.minter,
            config.royaltyRecipient
        ));
    }

    function collectionInitCodeHash(CollectionConfig calldata config) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            type(NFTCollection).creationCode,
            abi.encode(
                config.name,
                config.symbol,
                config.seriesSize,
                config.royaltyBps,
                config.owner,
                config.minter,
                config.royaltyRecipient
            )
        ));
    }

    function _validate(bytes32 releaseId, CollectionConfig calldata config) private pure {
        if (releaseId == bytes32(0)) revert EmptyReleaseId();
        if (bytes(config.name).length == 0 || bytes(config.symbol).length == 0) revert EmptyValue();
        if (config.seriesSize == 0) revert InvalidSeriesSize();
        if (config.royaltyBps > 10_000) revert InvalidRoyalty();
        if (config.owner == address(0) || config.minter == address(0) || config.royaltyRecipient == address(0)) {
            revert ZeroAddress();
        }
    }
}

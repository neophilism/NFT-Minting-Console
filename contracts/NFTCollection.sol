// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OwnableBasic} from "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import {ERC721OpenZeppelin} from "@limitbreak/creator-token-standards/src/token/erc721/ERC721OpenZeppelin.sol";
import {CreatorTokenBase} from "@limitbreak/creator-token-standards/src/utils/CreatorTokenBase.sol";
import {ICreatorToken} from "@limitbreak/creator-token-standards/src/interfaces/ICreatorToken.sol";
import {ICreatorTokenLegacy} from "@limitbreak/creator-token-standards/src/interfaces/ICreatorTokenLegacy.sol";
import {BasicRoyalties} from "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";

/// @notice Generic NFT collection based on the reviewed minimal ERC-721C-compatible architecture.
/// The collection does NOT inherit AutomaticValidatorTransferApproval.
/// Each release's name, symbol, supply, roles, and royalty are immutable constructor inputs.
/// OWNER maintains validator/marketplace compatibility, including powers that can block transfers.
contract NFTCollection is OwnableBasic, ERC721OpenZeppelin, CreatorTokenBase, BasicRoyalties {
    uint256 public immutable SERIES_SIZE;
    uint96 public immutable CREATOR_ROYALTY_BPS;
    uint16 private constant TOKEN_TYPE_ERC721 = 721;
    uint256 public constant MAX_BATCH = 10;

    address public immutable MINTER;
    address public immutable ROYALTY_RECIPIENT;
    uint256 public totalMinted;
    bool public mintingClosed;

    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => string) public workTitle;
    mapping(uint256 => bytes32) public mediaSHA256;
    mapping(uint256 => string) public rightsURI;
    mapping(uint256 => bytes32) public rightsSHA256;

    struct WorkInput {
        uint256 tokenId;
        string title;
        string metadataURI;
        bytes32 mediaHash;
        string rightsURI;
        bytes32 rightsHash;
    }

    error OnlyMinter();
    error ZeroAddress();
    error InvalidSeriesSize();
    error InvalidRoyalty();
    error InvalidBatchSize();
    error InvalidTokenId();
    error AlreadyMinted();
    error EmptyValue();
    error ZeroHash();
    error MintingIsClosed();
    error RenounceOwnershipDisabled();

    event WorkMinted(uint256 indexed tokenId, string title, string tokenURI, bytes32 mediaSHA256, string rightsURI, bytes32 rightsSHA256);
    event MintingClosed(uint256 totalMinted);

    constructor(
        string memory collectionName_,
        string memory symbol_,
        uint256 seriesSize_,
        uint96 royaltyBps_,
        address owner_,
        address minter_,
        address royaltyRecipient_
    ) ERC721OpenZeppelin(collectionName_, symbol_)
        BasicRoyalties(_validatedRoyaltyRecipient(royaltyRecipient_), _validatedRoyaltyBps(royaltyBps_))
    {
        if (owner_ == address(0) || minter_ == address(0)) revert ZeroAddress();
        if (bytes(collectionName_).length == 0 || bytes(symbol_).length == 0) revert EmptyValue();
        if (seriesSize_ == 0) revert InvalidSeriesSize();
        SERIES_SIZE = seriesSize_;
        CREATOR_ROYALTY_BPS = royaltyBps_;
        MINTER = minter_;
        ROYALTY_RECIPIENT = royaltyRecipient_;
        _transferOwnership(owner_);
    }

    function _validatedRoyaltyRecipient(address recipient) private pure returns (address) {
        if (recipient == address(0)) revert ZeroAddress();
        return recipient;
    }

    function _validatedRoyaltyBps(uint96 bps) private pure returns (uint96) {
        if (bps > 10_000) revert InvalidRoyalty();
        return bps;
    }

    modifier onlyMinter() {
        if (msg.sender != MINTER) revert OnlyMinter();
        _;
    }

    function renounceOwnership() public pure override { revert RenounceOwnershipDisabled(); }

    function closeMinting() external onlyMinter {
        if (mintingClosed) revert MintingIsClosed();
        mintingClosed = true;
        emit MintingClosed(totalMinted);
    }

    function mintWork(uint256 tokenId, string calldata title_, string calldata metadataURI_, bytes32 mediaHash_, string calldata rightsURI_, bytes32 rightsHash_) external onlyMinter {
        _mintWork(tokenId, title_, metadataURI_, mediaHash_, rightsURI_, rightsHash_);
    }

    /// @notice Mint up to ten works atomically with one minter wallet transaction.
    function mintWorksBatch(WorkInput[] calldata works) external onlyMinter {
        if (works.length == 0 || works.length > MAX_BATCH) revert InvalidBatchSize();
        for (uint256 i; i < works.length; ) {
            WorkInput calldata w = works[i];
            _mintWork(w.tokenId, w.title, w.metadataURI, w.mediaHash, w.rightsURI, w.rightsHash);
            unchecked { ++i; }
        }
    }

    function _mintWork(uint256 tokenId, string memory title_, string memory metadataURI_, bytes32 mediaHash_, string memory rightsURI_, bytes32 rightsHash_) internal {
        if (mintingClosed) revert MintingIsClosed();
        if (tokenId == 0 || tokenId > SERIES_SIZE) revert InvalidTokenId();
        if (_exists(tokenId)) revert AlreadyMinted();
        if (bytes(title_).length == 0 || bytes(metadataURI_).length == 0 || bytes(rightsURI_).length == 0) revert EmptyValue();
        if (mediaHash_ == bytes32(0) || rightsHash_ == bytes32(0)) revert ZeroHash();
        workTitle[tokenId] = title_;
        _tokenURIs[tokenId] = metadataURI_;
        mediaSHA256[tokenId] = mediaHash_;
        rightsURI[tokenId] = rightsURI_;
        rightsSHA256[tokenId] = rightsHash_;
        uint256 minted = ++totalMinted;
        _mint(MINTER, tokenId);
        emit WorkMinted(tokenId, title_, metadataURI_, mediaHash_, rightsURI_, rightsHash_);
        if (minted == SERIES_SIZE) {
            mintingClosed = true;
            emit MintingClosed(minted);
        }
    }

    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
        for (uint256 i; i < batchSize; ) { _validateBeforeTransfer(from, to, firstTokenId + i); unchecked { ++i; } }
    }
    function _afterTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
        for (uint256 i; i < batchSize; ) { _validateAfterTransfer(from, to, firstTokenId + i); unchecked { ++i; } }
    }
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (bytes4(keccak256("validateTransfer(address,address,address,uint256)")), true);
    }
    function _tokenType() internal pure override returns (uint16) { return TOKEN_TYPE_ERC721; }
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        return _tokenURIs[tokenId];
    }
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId || interfaceId == type(ICreatorTokenLegacy).interfaceId || super.supportsInterface(interfaceId);
    }
}

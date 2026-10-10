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

/// @title  Androids Of The Vine
/// @notice A fixed series of 40 digital works with ERC-721C transfer validation.
///
/// PERMANENT (no function can change these after deployment):
///   - the 40-token cap (token IDs 1-40);
///   - the 6% ERC-2981 royalty rate and its recipient;
///   - the MINTER address;
///   - every minted token's title, metadata URI, media SHA-256, rights URI and rights SHA-256.
///
/// OWNER (a trusted administrative role; use a 2-of-3 Safe):
///   - sets the ERC-721C transfer validator (`setTransferValidator`, inherited) and configures
///     the marketplace policy on that validator. This can loosen or tighten which marketplaces
///     may trade the token and can, if misused, block transfers. It cannot mint, cannot change
///     any token's data, cannot change the royalty, and cannot move or take a holder's token:
///     approvals are plain ERC-721 approvals granted only by holders.
///   - can transfer ownership to another non-zero address; can never renounce it.
///
/// MINTER:
///   - mints unused IDs, always to itself; may permanently close minting (also automatic at 40).
///
/// @dev Built from Limit Break's `CreatorTokenBase` directly rather than the `ERC721C` wrapper,
///      so the collection does NOT include `AutomaticValidatorTransferApproval`. There is no
///      way for the owner to grant a validator approval over holders' tokens.
contract AndroidsOfTheVineCollection is OwnableBasic, ERC721OpenZeppelin, CreatorTokenBase, BasicRoyalties {
    uint256 public constant SERIES_SIZE = 40;
    uint96 public constant CREATOR_ROYALTY_BPS = 600; // 6.00%
    uint16 private constant TOKEN_TYPE_ERC721 = 721;  // same value as @limitbreak/permit-c Constants.sol

    address public immutable MINTER;
    address public immutable ROYALTY_RECIPIENT;

    uint256 public totalMinted;
    bool public mintingClosed;

    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => string) public workTitle;
    mapping(uint256 => bytes32) public mediaSHA256;
    mapping(uint256 => string) public rightsURI;
    mapping(uint256 => bytes32) public rightsSHA256;

    error OnlyMinter();
    error ZeroAddress();
    error InvalidTokenId();
    error AlreadyMinted();
    error EmptyValue();
    error ZeroHash();
    error MintingIsClosed();
    error RenounceOwnershipDisabled();

    event WorkMinted(
        uint256 indexed tokenId,
        string title,
        string tokenURI,
        bytes32 mediaSHA256,
        string rightsURI,
        bytes32 rightsSHA256
    );
    event MintingClosed(uint256 totalMinted);

    /// @param owner_            Trusted administrator of the transfer policy (2-of-3 Safe recommended).
    /// @param minter_           Mints and initially holds every work (hardware wallet or Safe).
    /// @param royaltyRecipient_ Permanent recipient of the 6% royalty.
    constructor(address owner_, address minter_, address royaltyRecipient_)
        ERC721OpenZeppelin("Androids Of The Vine", "AOTV")
        BasicRoyalties(royaltyRecipient_, CREATOR_ROYALTY_BPS)
    {
        if (owner_ == address(0) || minter_ == address(0) || royaltyRecipient_ == address(0)) revert ZeroAddress();
        MINTER = minter_;
        ROYALTY_RECIPIENT = royaltyRecipient_;
        _transferOwnership(owner_);
    }

    modifier onlyMinter() {
        if (msg.sender != MINTER) revert OnlyMinter();
        _;
    }

    // ------------------------------------------------------------------ ownership

    /// @notice Disabled. Losing the owner would make the marketplace policy unmaintainable forever.
    function renounceOwnership() public pure override {
        revert RenounceOwnershipDisabled();
    }

    // ------------------------------------------------------------------ minting

    /// @notice Permanently closes minting. Cannot be reopened.
    function closeMinting() external onlyMinter {
        if (mintingClosed) revert MintingIsClosed();
        mintingClosed = true;
        emit MintingClosed(totalMinted);
    }

    /// @notice Mints one finalized work into an unused slot 1-40. The token goes to MINTER.
    /// @dev    Every field written here is permanent; there are deliberately no setters.
    function mintWork(
        uint256 tokenId,
        string calldata title_,
        string calldata tokenURI_,
        bytes32 mediaSHA256_,
        string calldata rightsURI_,
        bytes32 rightsSHA256_
    ) external onlyMinter {
        if (mintingClosed) revert MintingIsClosed();
        if (tokenId == 0 || tokenId > SERIES_SIZE) revert InvalidTokenId();
        if (_exists(tokenId)) revert AlreadyMinted();
        if (bytes(title_).length == 0 || bytes(tokenURI_).length == 0 || bytes(rightsURI_).length == 0) revert EmptyValue();
        if (mediaSHA256_ == bytes32(0) || rightsSHA256_ == bytes32(0)) revert ZeroHash();

        workTitle[tokenId] = title_;
        _tokenURIs[tokenId] = tokenURI_;
        mediaSHA256[tokenId] = mediaSHA256_;
        rightsURI[tokenId] = rightsURI_;
        rightsSHA256[tokenId] = rightsSHA256_;

        uint256 minted = ++totalMinted;
        _mint(MINTER, tokenId);
        emit WorkMinted(tokenId, title_, tokenURI_, mediaSHA256_, rightsURI_, rightsSHA256_);

        if (minted == SERIES_SIZE) {
            mintingClosed = true;
            emit MintingClosed(minted);
        }
    }

    // ------------------------------------------------------------------ ERC-721C transfer validation

    /// @dev Runs the validator's check before every transfer (mints and burns are not validated;
    ///      there is no burn function).
    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
        for (uint256 i = 0; i < batchSize; ) {
            _validateBeforeTransfer(from, to, firstTokenId + i);
            unchecked { ++i; }
        }
    }

    function _afterTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
        for (uint256 i = 0; i < batchSize; ) {
            _validateAfterTransfer(from, to, firstTokenId + i);
            unchecked { ++i; }
        }
    }

    /// @notice Tells marketplaces which validator function this token calls (ERC-721C convention).
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        functionSignature = bytes4(keccak256("validateTransfer(address,address,address,uint256)"));
        isViewFunction = true;
    }

    function _tokenType() internal pure override returns (uint16) {
        return TOKEN_TYPE_ERC721;
    }

    // ------------------------------------------------------------------ metadata / ERC-165

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        return _tokenURIs[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId
            || interfaceId == type(ICreatorTokenLegacy).interfaceId
            || super.supportsInterface(interfaceId);
    }
}

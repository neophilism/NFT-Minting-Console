// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IAuthorizationValidator {
    function beforeAuthorizedTransfer(address operator, address token, uint256 tokenId) external;
    function afterAuthorizedTransfer(address token, uint256 tokenId) external;
}

interface ITransferValidatorV5 {
    function validateTransfer(address caller, address from, address to) external view;
}

contract MockEOARegistry is IERC165 {
    mapping(address => bool) private _verified;

    function setVerified(address account, bool verified) external {
        _verified[account] = verified;
    }

    function isVerifiedEOA(address account) external view returns (bool) {
        return _verified[account];
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}

contract MarketplaceOperator {
    function transferNFT(address collection, address from, address to, uint256 tokenId) external {
        IERC721(collection).transferFrom(from, to, tokenId);
    }
}

contract ValidatorCollectionProbe {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function validate(address validator, address caller, address from, address to) external view {
        ITransferValidatorV5(validator).validateTransfer(caller, from, to);
    }
}

/// @dev Test-only stand-in for an atomic signed-zone authorizer/operator flow.
contract SignedZoneAuthorizerMock {
    function executeAuthorizedSale(
        address validator,
        address collection,
        address from,
        address to,
        uint256 tokenId
    ) external {
        IAuthorizationValidator(validator).beforeAuthorizedTransfer(address(this), collection, tokenId);
        IERC721(collection).transferFrom(from, to, tokenId);
        IAuthorizationValidator(validator).afterAuthorizedTransfer(collection, tokenId);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test-only ERC-1271 fixture. Not a Safe implementation or deployable wallet.
contract AuthWalletFixture {
    address public signer;
    bool public reverts;
    constructor(address signer_) { signer = signer_; }
    function setSigner(address signer_) external { signer = signer_; }
    function setReverts(bool value) external { reverts = value; }
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        require(!reverts, "fixture revert");
        if (signature.length != 65) return 0xffffffff;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        return ecrecover(hash, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

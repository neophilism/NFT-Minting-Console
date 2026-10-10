// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./StorageTstorish.sol";

/**
 * @title  Tloadish
 * @notice Based on https://github.com/ProjectOpenSea/tstorish/commit/a81ed74453ed7b9fe7e96a9906bc4def19b73e33
 */
abstract contract Tloadish {

    /*
     * ------------------------------------------------------------------------+
     * Opcode      | Mnemonic         | Stack              | Memory            |
     * ------------------------------------------------------------------------|
     * 60 0x02     | PUSH1 0x02       | 0x02               |                   |
     * 60 0x1e     | PUSH1 0x1e       | 0x1e 0x02          |                   |
     * 61 0x3d5c   | PUSH2 0x3d5c     | 0x3d5c 0x1e 0x02   |                   |
     * 3d          | RETURNDATASIZE   | 0 0x3d5c 0x1e 0x02 |                   |
     *                                                                         |
     * :: store deployed bytecode in memory: (3d) RETURNDATASIZE (5c) TLOAD :: |
     * 52          | MSTORE           | 0x1e 0x02          | [0..0x20): 0x3d5c |
     * f3          | RETURN           |                    | [0..0x20): 0x3d5c |
     * ------------------------------------------------------------------------+
     */
    uint256 constant _TLOAD_TEST_PAYLOAD = 0x6002_601e_613d5c_3d_52_f3;
    uint256 constant _TLOAD_TEST_PAYLOAD_LENGTH = 0x0a;
    uint256 constant _TLOAD_TEST_PAYLOAD_OFFSET = 0x16;

    // Declare an immutable variable to store the tload test contract address.
    address private immutable _tloadTestContract;

    // Declare an immutable variable to store the initial TLOAD support status.
    bool internal immutable _tloadInitialSupport;

    // Declare an immutable function type variable for the _getTloadish function
    // based on chain support for tload at time of deployment.
    function(uint256) view returns (uint256) internal immutable _getTstorish;

    // Declare a few custom revert error types.
    error TloadTestContractDeploymentFailed();

    /**
     * @dev Determine TLOAD availability during deployment. This involves
     *      attempting to deploy a contract that utilizes TLOAD as part of the
     *      contract construction bytecode, and configuring initial support for
     *      using TLOAD in place of SLOAD based on the result.
     */
    constructor() {
        // Deploy the contract testing TLOAD support and store the address.
        address tloadTestContract = _prepareTloadTest();

        // Ensure the deployment was successful.
        if (tloadTestContract == address(0)) {
            revert TloadTestContractDeploymentFailed();
        }

        // Determine if TLOAD is supported.
        _tloadInitialSupport = StorageTstorish.data().tstoreSupport = _testTload(tloadTestContract);

        if (_tloadInitialSupport) {
            // If TLOAD is supported, set functions to their versions that use
            // tload directly without support checks.
            _getTstorish = _getTstore;
        } else {
            // If TLOAD is not supported, set functions to their versions that 
            // fallback to sload until tstoreSupport is true.
            _getTstorish = _getTstorishWithSloadFallback;
        }

        // Set the address of the deployed TLOAD test contract as an immutable.
        _tloadTestContract = tloadTestContract;
    }

    /**
     * @dev Private function to read a TSTORISH value. Assigned to _getTstorish
     *      internal function variable at construction if chain has tload support.
     *
     * @param storageSlot The slot to read the TSTORISH value from.
     *
     * @return value The TSTORISH value at the given storage slot.
     */
    function _getTstore(
        uint256 storageSlot
    ) internal view returns (uint256 value) {
        assembly {
            value := tload(storageSlot)
        }
    }

    /**
     * @dev Private function to read a TSTORISH value with sload fallback. 
     *      Assigned to _getTstorish internal function variable at construction
     *      if chain does not have tload support.
     *
     * @param storageSlot The slot to read the TSTORISH value from.
     *
     * @return value The TSTORISH value at the given storage slot.
     */
    function _getTstorishWithSloadFallback(
        uint256 storageSlot
    ) internal view returns (uint256 value) {
        if (StorageTstorish.data().tstoreSupport) {
            assembly {
                value := tload(storageSlot)
            }
        } else {
            assembly {
                value := sload(storageSlot)
            }
        }
    }

    /**
     * @dev Private function to deploy a test contract that utilizes TLOAD as
     *      part of its fallback logic.
     */
    function _prepareTloadTest() private returns (address contractAddress) {
        // Utilize assembly to deploy a contract testing TLOAD support.
        assembly {
            // Write the contract deployment code payload to scratch space.
            mstore(0, _TLOAD_TEST_PAYLOAD)

            // Deploy the contract.
            contractAddress := create(
                0,
                _TLOAD_TEST_PAYLOAD_OFFSET,
                _TLOAD_TEST_PAYLOAD_LENGTH
            )
        }
    }

    /**
     * @dev Private view function to determine if TLOAD is supported by
     *      the current EVM implementation by attempting to call the test
     *      contract, which utilizes TLOAD as part of its fallback logic.
     */
    function _testTload(
        address tloadTestContract
    ) private view returns (bool ok) {
        // Call the test contract, which will perform a TLOAD test. If the call
        // does not revert, then TLOAD is supported. Do not forward all
        // available gas, as all forwarded gas will be consumed on revert.
        (ok, ) = tloadTestContract.staticcall{ gas: gasleft() / 10 }("");
    }
}
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ICreatorToken} from "@limitbreak/creator-token-standards/src/interfaces/ICreatorToken.sol";
import {ICreatorTokenLegacy} from "@limitbreak/creator-token-standards/src/interfaces/ICreatorTokenLegacy.sol";

contract BlockingTransferValidator {
    error TransferBlocked();

    function validateTransfer(address, address, address, uint256) external pure {
        revert TransferBlocked();
    }
}

contract CallExecutor {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory returndata) = target.call(data);
        if (!success) {
            assembly {
                revert(add(returndata, 32), mload(returndata))
            }
        }
        return returndata;
    }
}

contract InterfaceIdProbe {
    function creatorTokenIds() external pure returns (bytes4 current, bytes4 legacy) {
        return (type(ICreatorToken).interfaceId, type(ICreatorTokenLegacy).interfaceId);
    }
}

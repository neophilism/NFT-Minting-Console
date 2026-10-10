// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RulesetTest} from "../../../vendor/creator-token-transfer-validator/test/rulesets/RulesetTest.t.sol";
import {CreatorTokenTransferValidator} from "src/CreatorTokenTransferValidator.sol";
import {CollectionSecurityPolicy} from "src/DataTypes.sol";
import {
    LIST_TYPE_AUTHORIZERS,
    RULESET_ID_SOULBOUND,
    RULESET_ID_FIXED_OR_CUSTOM,
    FLAG_GLOBAL_ENABLE_ACCOUNT_FREEZING_MODE
} from "src/Constants.sol";
import {NFTCollection} from "../../contracts/NFTCollection.sol";

contract OperatorProxy {
    function transfer(address collection, address from, address to, uint256 tokenId) external {
        NFTCollection(collection).transferFrom(from, to, tokenId);
    }
}

contract SignedZonePattern {
    function executeSale(
        CreatorTokenTransferValidator validator,
        OperatorProxy operator,
        NFTCollection collection,
        address from,
        address to,
        uint256 tokenId
    ) external {
        validator.beforeAuthorizedTransfer(address(operator), address(collection), tokenId);
        operator.transfer(address(collection), from, to, tokenId);
        validator.afterAuthorizedTransfer(address(collection), tokenId);
    }
}

contract SafeLikeWallet {
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

contract DelegateTarget {}

contract NFTCollectionRealValidatorTest is RulesetTest {
    uint16 private constant REQUIRED_RULESET_OPTIONS = 6;
    bytes32 private constant MEDIA_HASH = keccak256("media");
    bytes32 private constant RIGHTS_HASH = keccak256("rights");

    NFTCollection private collection;
    OperatorProxy private operator;
    SignedZonePattern private signedZone;
    uint48 private marketplaceListId;

    function setUp() public override {
        super.setUp();
        collection = new NFTCollection("Validator Integration", "VALID", 12, 600, address(this), address(this), address(0xBEEF));
        operator = new OperatorProxy();
        signedZone = new SignedZonePattern();

        collection.setTransferValidator(address(validator));
        marketplaceListId = validator.createList("NFT Console marketplace authorizers");
        validator.applyListToCollection(address(collection), marketplaceListId);
        validator.setRulesetOfCollection(
            address(collection),
            RULESET_ID_FIXED_OR_CUSTOM,
            address(rulesetWhitelist),
            0,
            REQUIRED_RULESET_OPTIONS
        );
    }

    function testPolicyIsOwnedReadableAndPinnedToOptionsSix() public view {
        CollectionSecurityPolicy memory policy = validator.getCollectionSecurityPolicy(address(collection));
        assertEq(validator.listOwners(marketplaceListId), address(this));
        assertEq(policy.listId, marketplaceListId);
        assertEq(policy.rulesetId, RULESET_ID_FIXED_OR_CUSTOM);
        assertEq(policy.customRuleset, address(rulesetWhitelist));
        assertEq(policy.rulesetOptions, REQUIRED_RULESET_OPTIONS);
    }

    function testEOADirectTransferSucceedsWithoutRoyaltyPayment() public {
        address buyer = vm.addr(101);
        _mint(1);
        (address recipientBefore, uint256 royaltyBefore) = collection.royaltyInfo(1, 1 ether);
        uint256 buyerBalance = buyer.balance;

        collection.transferFrom(address(this), buyer, 1);

        assertEq(collection.ownerOf(1), buyer);
        assertEq(buyer.balance, buyerBalance);
        (address recipientAfter, uint256 royaltyAfter) = collection.royaltyInfo(1, 1 ether);
        assertEq(recipientAfter, recipientBefore);
        assertEq(royaltyAfter, royaltyBefore);
        assertEq(royaltyAfter, 0.06 ether);
    }

    function testSafeLikeWalletDirectTransferSucceedsWithOptionsSix() public {
        SafeLikeWallet safe = new SafeLikeWallet();
        address buyer = vm.addr(102);
        _mint(2);
        collection.transferFrom(address(this), address(safe), 2);

        safe.execute(
            address(collection),
            abi.encodeWithSignature("transferFrom(address,address,uint256)", address(safe), buyer, 2)
        );

        assertEq(collection.ownerOf(2), buyer);
    }

    function testEIP7702DelegatedEOADirectTransferSucceedsWithOptionsSix() public {
        address delegatedEOA = vm.addr(103);
        address buyer = vm.addr(104);
        DelegateTarget delegate = new DelegateTarget();
        vm.etch(delegatedEOA, abi.encodePacked(hex"ef0100", address(delegate)));
        _mint(3);
        collection.transferFrom(address(this), delegatedEOA, 3);

        vm.prank(delegatedEOA);
        collection.transferFrom(delegatedEOA, buyer, 3);

        assertEq(collection.ownerOf(3), buyer);
    }

    function testApprovedButUnauthorizedMarketplaceIsBlocked() public {
        address buyer = vm.addr(105);
        _mint(4);
        collection.approve(address(operator), 4);

        vm.expectRevert();
        operator.transfer(address(collection), address(this), buyer, 4);

        assertEq(collection.ownerOf(4), address(this));
    }

    function testSignedZonePatternAuthorizedSaleSucceeds() public {
        address buyer = vm.addr(106);
        _authorizeSignedZone();
        _mint(5);
        collection.approve(address(operator), 5);

        signedZone.executeSale(validator, operator, collection, address(this), buyer, 5);

        assertEq(collection.ownerOf(5), buyer);
    }

    function testOwnerCanAddMarketplaceAfterDeployment() public {
        address buyer = vm.addr(107);
        _mint(6);
        collection.approve(address(operator), 6);
        vm.expectRevert();
        signedZone.executeSale(validator, operator, collection, address(this), buyer, 6);

        _authorizeSignedZone();
        signedZone.executeSale(validator, operator, collection, address(this), buyer, 6);
        assertEq(collection.ownerOf(6), buyer);
    }

    function testOnlyOwnerCanAdministerListAndPolicy() public {
        address outsider = vm.addr(108);
        address[] memory accounts = _singleton(outsider);

        vm.startPrank(outsider);
        vm.expectRevert();
        validator.addAccountsToList(marketplaceListId, LIST_TYPE_AUTHORIZERS, accounts);
        vm.expectRevert();
        validator.setRulesetOfCollection(
            address(collection),
            RULESET_ID_FIXED_OR_CUSTOM,
            address(rulesetWhitelist),
            0,
            REQUIRED_RULESET_OPTIONS
        );
        vm.stopPrank();

        assertFalse(validator.isAccountInList(marketplaceListId, LIST_TYPE_AUTHORIZERS, outsider));
    }

    function testOwnerCanTightenAndRestorePolicy() public {
        address buyer = vm.addr(109);
        _mint(7);
        validator.setRulesetOfCollection(address(collection), RULESET_ID_SOULBOUND, address(0), 0, 0);

        vm.expectRevert();
        collection.transferFrom(address(this), buyer, 7);

        validator.setRulesetOfCollection(
            address(collection),
            RULESET_ID_FIXED_OR_CUSTOM,
            address(rulesetWhitelist),
            0,
            REQUIRED_RULESET_OPTIONS
        );
        collection.transferFrom(address(this), buyer, 7);
        assertEq(collection.ownerOf(7), buyer);
    }

    function testFreezeAndRestoreAreOwnerControlled() public {
        address buyer = vm.addr(110);
        address[] memory frozen = _singleton(address(this));
        _mint(8);
        validator.setRulesetOfCollection(
            address(collection),
            RULESET_ID_FIXED_OR_CUSTOM,
            address(rulesetWhitelist),
            FLAG_GLOBAL_ENABLE_ACCOUNT_FREEZING_MODE,
            REQUIRED_RULESET_OPTIONS
        );
        validator.freezeAccountsForCollection(address(collection), frozen);
        assertTrue(validator.isAccountFrozenForCollection(address(collection), address(this)));

        vm.expectRevert();
        collection.transferFrom(address(this), buyer, 8);

        validator.unfreezeAccountsForCollection(address(collection), frozen);
        collection.transferFrom(address(this), buyer, 8);
        assertEq(collection.ownerOf(8), buyer);
    }

    function testValidatorAndOperatorCannotSeizeWithoutHolderApproval() public {
        address buyer = vm.addr(111);
        _mint(9);

        vm.prank(address(validator));
        vm.expectRevert();
        collection.transferFrom(address(this), buyer, 9);

        vm.prank(address(operator));
        vm.expectRevert();
        collection.transferFrom(address(this), buyer, 9);
        assertEq(collection.ownerOf(9), address(this));
    }

    function testRoyaltyConfigurationSurvivesPolicyChanges() public {
        (address recipientBefore, uint256 amountBefore) = collection.royaltyInfo(10, 10_000);
        validator.setRulesetOfCollection(address(collection), RULESET_ID_SOULBOUND, address(0), 0, 0);
        validator.setRulesetOfCollection(
            address(collection),
            RULESET_ID_FIXED_OR_CUSTOM,
            address(rulesetWhitelist),
            0,
            REQUIRED_RULESET_OPTIONS
        );
        (address recipientAfter, uint256 amountAfter) = collection.royaltyInfo(10, 10_000);
        assertEq(recipientAfter, recipientBefore);
        assertEq(amountAfter, amountBefore);
        assertEq(amountAfter, 600);
    }

    function _authorizeSignedZone() private {
        validator.addAccountsToList(marketplaceListId, LIST_TYPE_AUTHORIZERS, _singleton(address(signedZone)));
    }

    function _mint(uint256 tokenId) private {
        collection.mintWork(
            tokenId,
            "Work",
            "ipfs://metadata",
            MEDIA_HASH,
            "ipfs://rights",
            RIGHTS_HASH
        );
    }

    function _singleton(address account) private pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = account;
    }
}

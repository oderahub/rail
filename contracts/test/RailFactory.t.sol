// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RailFactory} from "../src/RailFactory.sol";
import {RailVault} from "../src/RailVault.sol";
import {MockERC20, MockModule, MockOutcomeToken} from "./mocks/Mocks.sol";

contract RailFactoryTest is Test {
    MockERC20 usdc;
    MockModule module;
    MockOutcomeToken outcome;
    RailFactory factory;

    address bot = makeAddr("bot");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    RailVault.Policy p = RailVault.Policy({
        maxNotionalPerOrder: 10e6,
        dailyCap: 25e6,
        cooldownSecs: 0,
        minExpiryHeadroom: 60
    });

    function setUp() public {
        usdc = new MockERC20();
        module = new MockModule();
        outcome = new MockOutcomeToken();
        factory = new RailFactory(bot, address(usdc), address(module), address(outcome));
    }

    /// The web page must be able to show the address before the deploy is signed.
    function test_addressIsPredictableBeforeDeploy() public {
        address predicted = factory.vaultOf(alice, p);
        address actual = factory.deployFor(alice, p);
        assertEq(actual, predicted, "CREATE2 address must match the prediction");
    }

    function test_deployedVaultHasCorrectRolesAndPolicy() public {
        RailVault v = RailVault(factory.deployFor(alice, p));
        assertEq(v.owner(), alice);
        assertEq(v.operator(), bot);
        assertEq(address(v.collateral()), address(usdc));
        (uint128 maxOrder, uint128 daily,, uint32 headroom) = v.policy();
        assertEq(maxOrder, 10e6);
        assertEq(daily, 25e6);
        assertEq(headroom, 60);
    }

    function test_oneVaultPerOwner() public {
        address v = factory.deployFor(alice, p);
        vm.expectRevert(abi.encodeWithSelector(RailFactory.AlreadyDeployed.selector, v));
        factory.deployFor(alice, p);
    }

    function test_differentOwnersGetDifferentVaults() public {
        assertTrue(factory.deployFor(alice, p) != factory.deployFor(bob, p));
    }

    /// Anyone may deploy FOR a user — it costs the caller gas and the user still
    /// owns the result, so sponsoring a user's first deploy is safe.
    function test_anyoneCanDeployForSomeoneElse() public {
        vm.prank(bob);
        RailVault v = RailVault(factory.deployFor(alice, p));
        assertEq(v.owner(), alice, "sponsor must not become the owner");
    }
}

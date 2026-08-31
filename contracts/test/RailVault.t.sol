// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RailVault} from "../src/RailVault.sol";
import {MockERC20, MockPool, MockModule, MockOutcomeToken} from "./mocks/Mocks.sol";

contract RailVaultTest is Test {
    MockERC20 usdc;
    MockPool pool;
    MockModule module;
    MockOutcomeToken outcome;
    RailVault vault;

    address user = makeAddr("user");
    address bot = makeAddr("bot");
    address stranger = makeAddr("stranger");

    uint128 constant MAX_PER_ORDER = 10e6; // 10 tUSDC
    uint128 constant DAILY_CAP = 25e6; // 25 tUSDC

    function setUp() public {
        usdc = new MockERC20();
        pool = new MockPool(usdc);
        module = new MockModule();
        outcome = new MockOutcomeToken();
        vault = new RailVault(
            user,
            bot,
            address(usdc),
            address(module),
            address(outcome),
            RailVault.Policy({
                maxNotionalPerOrder: MAX_PER_ORDER,
                dailyCap: DAILY_CAP,
                cooldownSecs: 0,
                minExpiryHeadroom: 60
            })
        );
        usdc.mint(address(vault), 1000e6);
        vm.warp(1_800_000_000);
    }

    /// notional = price * quantity / 1e6, so 0.5e6 * (usd * 2e6) / 1e6 == usd * 1e6
    function _o(uint256 usd) internal view returns (RailVault.OrderParams memory) {
        return RailVault.OrderParams({
            pool: address(pool),
            kind: 0,
            price: 0.5e6,
            quantity: usd * 2e6,
            expireTimestampNs: uint64((block.timestamp + 600) * 1e9),
            orderType: 2,
            selfMatchingOption: 0,
            builder: address(0),
            builderFeeBpsTimes1k: 0,
            userData: 0
        });
    }

    // ── roles ────────────────────────────────────────────────────────────────

    function test_onlyOperatorCanPlace() public {
        vm.prank(stranger);
        vm.expectRevert(RailVault.NotOperator.selector);
        vault.placeOrder(_o(1));
    }

    function test_ownerCannotPlace() public {
        vm.prank(user);
        vm.expectRevert(RailVault.NotOperator.selector);
        vault.placeOrder(_o(1));
    }

    /// The bot may push funds home — it can never redirect them, because the
    /// destination is hardcoded. This is what makes /withdraw signature-free.
    function test_operatorCanWithdrawButOnlyToOwner() public {
        uint256 before = usdc.balanceOf(user);
        vm.prank(bot);
        vault.withdraw(1e6);
        assertEq(usdc.balanceOf(user) - before, 1e6, "funds must land with the owner");
    }

    function test_strangerCannotWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(RailVault.NotOwner.selector);
        vault.withdraw(1e6);
    }

    function test_withdrawAllSweepsToOwner() public {
        uint256 vaultBal = usdc.balanceOf(address(vault));
        vm.prank(bot);
        uint256 swept = vault.withdrawAll();
        assertEq(swept, vaultBal);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(user), vaultBal);
    }

    function test_ownerWithdraws() public {
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.withdraw(50e6);
        assertEq(usdc.balanceOf(user) - before, 50e6);
    }

    // ── the four on-chain rules ──────────────────────────────────────────────

    function test_happyPath() public {
        vm.prank(bot);
        (bool ok,) = vault.placeOrder(_o(5));
        assertTrue(ok);
        assertEq(vault.spentInWindow(), 5e6);
    }

    function test_rejectsOversizedOrder() public {
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(RailVault.OrderTooLarge.selector, 11e6, MAX_PER_ORDER));
        vault.placeOrder(_o(11));
    }

    function test_dailyCapAccumulatesThenBlocks() public {
        vm.startPrank(bot);
        vault.placeOrder(_o(10));
        vault.placeOrder(_o(10));
        assertEq(vault.spentInWindow(), 20e6);
        vm.expectRevert(abi.encodeWithSelector(RailVault.DailyCapExceeded.selector, 20e6, 10e6, DAILY_CAP));
        vault.placeOrder(_o(10));
        vm.stopPrank();
    }

    function test_dailyCapRollsAfter24h() public {
        vm.startPrank(bot);
        vault.placeOrder(_o(10));
        vault.placeOrder(_o(10));
        vm.warp(block.timestamp + 1 days + 1);
        vault.placeOrder(_o(10)); // fresh window
        assertEq(vault.spentInWindow(), 10e6);
        vm.stopPrank();
    }

    function test_cooldownEnforced() public {
        vm.prank(user);
        vault.setPolicy(
            RailVault.Policy({
                maxNotionalPerOrder: MAX_PER_ORDER,
                dailyCap: DAILY_CAP,
                cooldownSecs: 300,
                minExpiryHeadroom: 60
            })
        );
        vm.startPrank(bot);
        vault.placeOrder(_o(1));
        vm.expectRevert(abi.encodeWithSelector(RailVault.Cooldown.selector, uint64(300)));
        vault.placeOrder(_o(1));
        vm.warp(block.timestamp + 300);
        vault.placeOrder(_o(1)); // now allowed
        vm.stopPrank();
    }

    function test_rejectsExpiryTooSoon() public {
        RailVault.OrderParams memory o = _o(1);
        o.expireTimestampNs = uint64((block.timestamp + 10) * 1e9); // headroom is 60
        vm.prank(bot);
        vm.expectRevert(
            abi.encodeWithSelector(
                RailVault.ExpiryTooSoon.selector, uint64(block.timestamp + 10), uint64(block.timestamp + 60)
            )
        );
        vault.placeOrder(o);
    }

    /// The one that matters: the pool takes MORE than the vault intended.
    /// The pre-check passes; the post-check must still unwind the whole thing.
    function test_postCheckBindsWhenPoolOvercharges() public {
        pool.setCharge(50e6); // vault intended 1, pool takes 50
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(RailVault.OrderTooLarge.selector, 50e6, MAX_PER_ORDER));
        vault.placeOrder(_o(1));
        assertEq(usdc.balanceOf(address(vault)), 1000e6, "revert must unwind the spend");
        assertEq(vault.spentInWindow(), 0);
    }

    // ── halt & exit ──────────────────────────────────────────────────────────

    function test_haltBlocksTrading() public {
        vm.prank(user);
        vault.setHalted(true);
        vm.prank(bot);
        vm.expectRevert(RailVault.Halted_.selector);
        vault.placeOrder(_o(1));
    }

    function test_emergencyExitHaltsCancelsAndSweeps() public {
        vm.prank(bot);
        vault.placeOrder(_o(5));

        address[] memory pools = new address[](1);
        uint128[] memory ids = new uint128[](1);
        pools[0] = address(pool);
        ids[0] = 1;

        uint256 vaultBal = usdc.balanceOf(address(vault));
        vm.prank(user);
        vault.emergencyExit(pools, ids);

        assertTrue(vault.halted());
        assertEq(pool.lastCancelled(), 1);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(user), vaultBal);
    }

    function test_strangerCannotEmergencyExit() public {
        address[] memory pools = new address[](0);
        uint128[] memory ids = new uint128[](0);
        vm.prank(stranger);
        vm.expectRevert(RailVault.NotOwner.selector);
        vault.emergencyExit(pools, ids);
    }

    /// Redeem only ever moves value IN, so a shared sweeper may call it.
    function test_redeemIsPermissionless() public {
        vm.prank(stranger);
        vault.redeem(2, bytes32(uint256(1)), bytes32(uint256(2)), 0, 5e6);
    }

    /// Without this the module cannot burn the vault's outcome tokens and every
    /// redeem reverts, stranding winnings. The SDK grants it for an EOA on first
    /// redeem; a contract has to do it itself.
    function test_moduleIsApprovedToRedeemFromBirth() public view {
        assertTrue(outcome.isOperator(address(vault), address(module)), "module must be able to burn on redeem");
        assertTrue(vault.moduleCanRedeem());
    }

    function test_remainingTodayReflectsSpend() public {
        assertEq(vault.remainingToday(), DAILY_CAP);
        vm.prank(bot);
        vault.placeOrder(_o(10));
        assertEq(vault.remainingToday(), DAILY_CAP - 10e6);
    }
}

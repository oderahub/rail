// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IBinaryPool, IBinaryMarket, IBinaryModule, IERC20, IERC6909} from "./interfaces/IDreamDEX.sol";

/**
 * RailVault — the order owner.
 *
 * DreamDEX BinaryPool has no operator-permission registry (that exists only for
 * SpotPool). So the only way to let a bot trade for you without handing it your
 * funds is to make a CONTRACT the order owner: it holds the collateral, the bot
 * key merely triggers it, and withdrawal stays behind a rule.
 *
 * The vault holds and spends its OWN collateral. The operator never funds an
 * order — that is what produces `IncorrectSender` on the pool.
 *
 * Every limit here is enforceable on-chain without trusting the operator.
 * Deliberately absent: a per-window cap. The pool's placeBinaryOrder takes no
 * market id, and pools are recycled between windows, so any "window" the
 * operator declared would be a number the vault cannot verify. A per-order cap
 * plus a rolling daily cap bound the same exposure and cannot be gamed by
 * relabelling.
 */
contract RailVault {
    // ── roles ────────────────────────────────────────────────────────────────
    address public immutable owner;    // the user; alone may withdraw
    address public operator;           // the bot key; may only trade, within policy

    IERC20 public immutable collateral;
    IBinaryModule public immutable module;
    IERC6909 public immutable outcomeToken;
    uint256 public immutable priceScale; // 10 ** collateral.decimals()

    // ── policy ───────────────────────────────────────────────────────────────
    struct Policy {
        uint128 maxNotionalPerOrder; // raw collateral
        uint128 dailyCap;            // raw collateral, rolling 24h
        uint32 cooldownSecs;         // minimum gap between orders
        uint32 minExpiryHeadroom;    // order must expire >= this many secs out
    }

    Policy public policy;

    uint256 public spentInWindow;  // rolling-day accumulator
    uint64 public windowStart;     // unix secs
    uint64 public lastOrderAt;
    bool public halted;

    // ── events ───────────────────────────────────────────────────────────────
    event PolicySet(uint128 maxNotionalPerOrder, uint128 dailyCap, uint32 cooldownSecs, uint32 minExpiryHeadroom);
    event OperatorSet(address indexed operator);
    event OrderPlaced(address indexed pool, uint128 orderId, uint256 price, uint256 quantity, uint256 spent);
    event OrderCancelled(address indexed pool, uint128 orderId);
    event Redeemed(bytes32 indexed marketId, uint8 outcomeIdx, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Halted(bool halted);

    // ── errors — named so the demo can show WHICH rule stopped the trade ─────
    error NotOwner();
    error NotOperator();
    error Halted_();
    error OrderTooLarge(uint256 notional, uint256 limit);
    error DailyCapExceeded(uint256 spentToday, uint256 wouldSpend, uint256 limit);
    error Cooldown(uint64 secsRemaining);
    error ExpiryTooSoon(uint64 expirySecs, uint64 earliestAllowed);
    error PoolNotFunded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address _owner,
        address _operator,
        address _collateral,
        address _module,
        address _outcomeToken,
        Policy memory _policy
    ) {
        owner = _owner;
        operator = _operator;
        collateral = IERC20(_collateral);
        module = IBinaryModule(_module);
        outcomeToken = IERC6909(_outcomeToken);
        priceScale = 10 ** IERC20(_collateral).decimals();
        policy = _policy;

        // Redeeming burns the vault's ERC-6909 outcome tokens, so the module
        // must be an operator on them. The SDK grants this for an EOA on its
        // first redeem; a contract owner has to do it itself, and nothing
        // documents that. Without it, redeem reverts and winnings are stranded.
        // typed, not low-level: a vault that cannot redeem is broken, so this
        // should fail at deploy rather than strand winnings later
        IERC6909(_outcomeToken).setOperator(_module, true);
        windowStart = uint64(block.timestamp);
        emit PolicySet(_policy.maxNotionalPerOrder, _policy.dailyCap, _policy.cooldownSecs, _policy.minExpiryHeadroom);
        emit OperatorSet(_operator);
    }

    // ── trading ──────────────────────────────────────────────────────────────

    /**
     * Place an order the vault owns and pays for.
     * Policy is checked twice: a cheap pre-check on the intended notional so the
     * revert names the rule, then an authoritative post-check on collateral the
     * pool ACTUALLY took. The second is what binds — a partial fill, a price
     * improvement or an unexpected charge cannot slip past it, because reverting
     * afterwards unwinds the order too.
     */
    struct OrderParams {
        address pool;
        uint8 kind;
        uint256 price;
        uint256 quantity;
        uint64 expireTimestampNs;
        uint8 orderType;
        uint8 selfMatchingOption;
        address builder;
        uint96 builderFeeBpsTimes1k;
        uint64 userData;
    }

    function placeOrder(OrderParams calldata o) external onlyOperator returns (bool ok, uint128 orderId) {
        if (halted) revert Halted_();

        Policy memory p = policy;

        uint64 nowSecs = uint64(block.timestamp);
        if (p.cooldownSecs != 0 && lastOrderAt != 0) {
            uint64 earliest = lastOrderAt + p.cooldownSecs;
            if (nowSecs < earliest) revert Cooldown(earliest - nowSecs);
        }

        // expireTimestampNs is nanoseconds; the pool rejects past/zero values.
        uint64 expirySecs = o.expireTimestampNs / 1e9;
        uint64 earliestAllowed = nowSecs + p.minExpiryHeadroom;
        if (expirySecs < earliestAllowed) revert ExpiryTooSoon(expirySecs, earliestAllowed);

        uint256 intended = (o.price * o.quantity) / priceScale;
        if (intended > p.maxNotionalPerOrder) revert OrderTooLarge(intended, p.maxNotionalPerOrder);

        _rollWindow();
        if (spentInWindow + intended > p.dailyCap) {
            revert DailyCapExceeded(spentInWindow, intended, p.dailyCap);
        }

        uint256 before = collateral.balanceOf(address(this));
        if (before == 0) revert PoolNotFunded();

        collateral.approve(o.pool, before);
        (ok, orderId) = IBinaryPool(o.pool).placeBinaryOrder(
            o.kind,
            o.price,
            o.quantity,
            o.expireTimestampNs,
            o.orderType,
            o.selfMatchingOption,
            o.builder,
            o.builderFeeBpsTimes1k,
            o.userData
        );
        collateral.approve(o.pool, 0);

        uint256 after_ = collateral.balanceOf(address(this));
        uint256 spent = before > after_ ? before - after_ : 0;

        // authoritative: bind on what actually left the vault
        if (spent > p.maxNotionalPerOrder) revert OrderTooLarge(spent, p.maxNotionalPerOrder);
        if (spentInWindow + spent > p.dailyCap) {
            revert DailyCapExceeded(spentInWindow, spent, p.dailyCap);
        }

        spentInWindow += spent;
        lastOrderAt = nowSecs;
        emit OrderPlaced(o.pool, orderId, o.price, o.quantity, spent);
    }

    /// Only the order's owner may cancel on a BinaryPool — and the vault is the
    /// owner, so without this the user's resting orders are unreachable.
    function cancelOrder(address pool, uint128 orderId) external {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        IBinaryPool(pool).cancelOrder(orderId);
        emit OrderCancelled(pool, orderId);
    }

    /// Permissionless: redeeming only ever moves value INTO the vault, so anyone
    /// may trigger it. That is what lets a shared sweeper claim for every user.
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount)
        external
    {
        module.redeem(operatorId, venueId, marketId, outcomeIdx, amount);
        emit Redeemed(marketId, outcomeIdx, amount);
    }

    // ── owner ────────────────────────────────────────────────────────────────

    /**
     * Send collateral home. Callable by the owner OR the operator, because the
     * destination is hardcoded to `owner` — the bot can return your money, it
     * can never redirect it. That is what makes `/withdraw` in the bot a
     * zero-signature action without making the vault custodial.
     */
    function withdraw(uint256 amount) external {
        if (msg.sender != owner && msg.sender != operator) revert NotOwner();
        _safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// Sweep everything home in one call — what `/withdraw` uses.
    function withdrawAll() external returns (uint256 amount) {
        if (msg.sender != owner && msg.sender != operator) revert NotOwner();
        amount = collateral.balanceOf(address(this));
        if (amount != 0) {
            _safeTransfer(owner, amount);
            emit Withdrawn(owner, amount);
        }
    }

    /// Re-grant the module's burn approval if it is ever cleared. Harmless: it
    /// only lets the protocol settle positions this vault already holds.
    function approveRedeemer() external {
        if (msg.sender != owner && msg.sender != operator) revert NotOwner();
        outcomeToken.setOperator(address(module), true);
    }

    /// Owner-only exit: halt, cancel everything named, sweep home. Checks no
    /// policy and calls nothing that can re-enter a limit.
    function emergencyExit(address[] calldata pools, uint128[] calldata orderIds) external onlyOwner {
        halted = true;
        emit Halted(true);
        for (uint256 i = 0; i < pools.length; ++i) {
            try IBinaryPool(pools[i]).cancelOrder(orderIds[i]) {} catch {}
        }
        uint256 bal = collateral.balanceOf(address(this));
        if (bal != 0) {
            _safeTransfer(owner, bal);
            emit Withdrawn(owner, bal);
        }
    }

    function setPolicy(Policy calldata p) external onlyOwner {
        policy = p;
        emit PolicySet(p.maxNotionalPerOrder, p.dailyCap, p.cooldownSecs, p.minExpiryHeadroom);
    }

    function setOperator(address o) external onlyOwner {
        operator = o;
        emit OperatorSet(o);
    }

    function setHalted(bool h) external onlyOwner {
        halted = h;
        emit Halted(h);
    }

    /// Sweep won outcome tokens home (they are ERC-6909, not ERC-20).
    function withdrawOutcome(address token, uint256 id, uint256 amount) external onlyOwner {
        IERC6909(token).transfer(owner, id, amount);
    }

    function moduleCanRedeem() external view returns (bool) {
        return outcomeToken.isOperator(address(this), address(module));
    }

    // ── views ────────────────────────────────────────────────────────────────

    function remainingToday() external view returns (uint256) {
        if (block.timestamp >= windowStart + 1 days) return policy.dailyCap;
        uint256 cap = policy.dailyCap;
        return spentInWindow >= cap ? 0 : cap - spentInWindow;
    }

    error TransferFailed();

    function _safeTransfer(address to, uint256 amount) internal {
        if (!collateral.transfer(to, amount)) revert TransferFailed();
    }

    function _rollWindow() internal {
        if (block.timestamp >= windowStart + 1 days) {
            windowStart = uint64(block.timestamp);
            spentInWindow = 0;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockERC20 {
    string public name = "TestUSDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// Pulls `chargeOverride` if set, otherwise price*quantity/1e6 — so a test can
/// make the pool take MORE than the vault intended and prove the post-check binds.
contract MockPool {
    MockERC20 public immutable token;
    uint256 public chargeOverride;
    uint128 public nextOrderId = 1;
    uint128 public lastCancelled;

    constructor(MockERC20 t) { token = t; }
    function setCharge(uint256 c) external { chargeOverride = c; }
    function market() external view returns (address) { return address(this); }
    function collateral() external view returns (address) { return address(token); }

    function placeBinaryOrder(
        uint8, uint256 price, uint256 quantity, uint64, uint8, uint8, address, uint96, uint64
    ) external payable returns (bool, uint128) {
        uint256 charge = chargeOverride != 0 ? chargeOverride : (price * quantity) / 1e6;
        token.transferFrom(msg.sender, address(this), charge);
        return (true, nextOrderId++);
    }

    function cancelOrder(uint128 id) external { lastCancelled = id; }
}

contract MockModule {
    event Redeemed(bytes32 marketId, uint8 idx, uint256 amount);
    function redeem(uint32, bytes32, bytes32 marketId, uint8 idx, uint256 amount) external {
        emit Redeemed(marketId, idx, amount);
    }
}

contract MockOutcomeToken {
    mapping(address => mapping(address => bool)) public isOperator;
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    function setOperator(address spender, bool approved) external returns (bool) {
        isOperator[msg.sender][spender] = approved;
        return true;
    }

    function transfer(address to, uint256 id, uint256 amount) external returns (bool) {
        balanceOf[msg.sender][id] -= amount;
        balanceOf[to][id] += amount;
        return true;
    }

    function mint(address to, uint256 id, uint256 amount) external { balanceOf[to][id] += amount; }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RailVault} from "./RailVault.sol";

/**
 * One vault per user, at an address anyone can compute before it exists.
 *
 * The bot needs to know a user's vault address without keeping a mapping it
 * could lose or lie about, and the web page needs to show that address before
 * the deploy is signed. CREATE2 salted on the owner gives both.
 *
 * `operator` is immutable here: every vault this factory mints trusts the same
 * bot key. Rotating that key means deploying a new factory — existing users
 * move by calling `setOperator` on their own vault, which is the right way
 * round, because changing who may trade for you should need your signature.
 */
contract RailFactory {
    address public immutable operator;
    address public immutable collateral;
    address public immutable module;
    address public immutable outcomeToken;

    mapping(address => address) public vaultOfOwner;

    event VaultDeployed(address indexed owner, address vault);

    error AlreadyDeployed(address vault);

    constructor(address _operator, address _collateral, address _module, address _outcomeToken) {
        operator = _operator;
        collateral = _collateral;
        module = _module;
        outcomeToken = _outcomeToken;
    }

    function deployFor(address owner, RailVault.Policy calldata policy) external returns (address vault) {
        address existing = vaultOfOwner[owner];
        if (existing != address(0)) revert AlreadyDeployed(existing);

        vault = address(new RailVault{salt: _salt(owner)}(owner, operator, collateral, module, outcomeToken, policy));
        vaultOfOwner[owner] = vault;
        emit VaultDeployed(owner, vault);
    }

    /// The address `owner`'s vault will have (or already has).
    function vaultOf(address owner, RailVault.Policy calldata policy) public view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(type(RailVault).creationCode, abi.encode(owner, operator, collateral, module, outcomeToken, policy))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(owner), initHash)))));
    }

    function _salt(address owner) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner));
    }
}

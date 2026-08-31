// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Signatures taken verbatim from the SDK's `binaryPoolWriteAbi` /
// `binaryModuleWriteAbi` (@somnia-chain/markets-sdk 0.28.1). Do not "tidy"
// these — argument order and widths are selector-critical.
// `builderFeeBpsTimes1k` in particular must stay uint96: uint256 reverts with
// nothing decodable.
interface IBinaryPool {
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool, uint128);

    function cancelOrder(uint128 orderId) external;
    function market() external view returns (address);
}

// collateral() lives on the per-window Market, NOT on the pool.
interface IBinaryMarket {
    function collateral() external view returns (address);
}

interface IBinaryModule {
    function redeem(
        uint32 operatorId,
        bytes32 venueId,
        bytes32 marketId,
        uint8 outcomeIdx,
        uint256 amount
    ) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IERC6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
    function setOperator(address spender, bool approved) external returns (bool);
    function isOperator(address owner, address spender) external view returns (bool);
}

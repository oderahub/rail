import { parseAbi } from "viem";

/**
 * dreamDEX custom errors, transcribed from docs.dreamdex.io/developers/contracts/errors.
 * The SDK ships these internally but does not re-export them, and we want the
 * selectors decodable so a failure reads as a sentence rather than a hex blob.
 */
export const protocolErrorsAbi = parseAbi([
  // order validation
  "error InvalidPrice(uint256 price, uint256 tickSize)",
  "error InvalidQuantity(uint256 quantity, uint256 constraint)",
  "error QuantityBelowMinimum(uint256 quantity, uint256 minimum)",
  "error InvalidAmount()",
  "error PriceTooLarge()",
  "error InvalidTakerSide()",
  "error ZeroQuoteFillsAllowed()",
  // rejection
  "error OrderAlreadyExpired()",
  "error SelfMatchCancelTaker()",
  "error PostOnlyWouldCross()",
  "error FillOrKillNotFillable()",
  "error ImmediateOrCancelNoFill()",
  // funding
  "error InsufficientBalance(uint256 available, uint256 required)",
  "error InvalidMsgValue(uint256 expected, uint256 received)",
  "error NativeTokenTransferFailed()",
  "error InsufficientGasForPayout(uint256 gasLeft)",
  // lifecycle
  "error ExpiredOrderMustBeCancelled(uint128 orderId)",
  "error OrderIdMismatch()",
  "error IncorrectOrder()",
  "error IncorrectSender(address caller, address expected)",
  // authorization
  "error OnlyApprovedContracts()",
  "error OwnableUnauthorizedAccount(address account)",
  // builder codes
  "error BuilderCodesNotSupported()",
  "error InvalidBuilder()",
  "error BuilderNotApproved()",
  "error BuilderFeeExceedsApproval()",
  "error BuilderFeeExceedsCap()",
  "error FeeTooHigh()",
]);

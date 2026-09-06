# DreamDEX Event Contracts Integration Feedback & Technical Findings

This document summarizes four technical findings discovered while building **Rail** on Somnia testnet (Shannon) using `@somnia-chain/markets-sdk` `0.28.1`. Each finding is accompanied by a script in the repository that reproduces the exact on-chain behavior.

---

## Finding 1: Delegated Binary Order Placement (`placeBinaryOrderFor`) is Unreachable

### Summary
The `BinaryPool` contract ABI includes `placeBinaryOrderFor(address owner, ...)`, which is intended to allow approved operators to place binary orders on behalf of an account. However, attempting to call this function from an approved operator address reverts with selector `0x3fb0ba2e` (`OnlyApprovedContracts`).

### Root Cause
The `OperatorPermissionsRegistry` provided by dreamDEX gates operator permissions for `SpotPool` (`placeOrderFor`), but no corresponding operator approval mechanism exists for `BinaryPool`. As a result, calling `placeBinaryOrderFor` from a non-owner address is unreachable under all conditions.

### Impact
Delegated binary trading is impossible for EOAs without handing over private keys. The only working architecture today is making a smart contract (e.g. `RailVault`) the order owner.

### Reproduction
```bash
npx tsc-node scripts/delegation.ts
```

---

## Finding 2: Smart Contract Order Owners Require Manual ERC-6909 Operator Approval to Redeem

### Summary
When an EOA redeems winning outcome tokens on dreamDEX, the SDK or web frontend automatically grants `setOperator(binaryModule, true)` on the ERC-6909 outcome token contract. However, when a **smart contract** (like a vault) owns the position, calling `BinaryModule.redeem(...)` reverts because `binaryModule` is not approved to burn the vault's outcome tokens.

### Root Cause
`BinaryModule` burns the user's ERC-6909 outcome tokens during redemption. ERC-6909 requires explicit operator authorization from the token holder (`isOperator(holder, spender) == true`). Nothing in the developer documentation specifies that contract order owners must grant this approval manually.

### Solution Implemented in Rail
`RailVault` grants operator status to `BinaryModule` directly in its constructor (`IERC6909(outcomeToken).setOperator(_module, true)`).

### Reproduction
```bash
npx tsc-node scripts/erc6909.ts
```

---

## Finding 3: Order Expiry Cannot Equal Market Window Expiry

### Summary
Setting an order's `expireTimestampNs` to equal the exact remaining time of the market window (e.g., `w.secsLeft`) causes the transaction to revert on-chain with selector `0xd3dea628`.

### Root Cause
The `BinaryPool` contract enforces that an order's expiration must fall strictly before the market window's settlement timestamp. Setting order expiry equal to market expiry causes a hidden validation failure ("order would outlive the market").

### Solution Implemented in Rail
`orderExpiryFor(w)` caps the order expiry at `w.secsLeft - 20` seconds to guarantee execution within valid window bounds.

### Reproduction
```bash
npx tsc-node scripts/expiry.ts
```

---

## Finding 4: Error Selector Discrepancies Between Docs and Contracts

### Summary
Several error selectors returned by `BinaryPool` and `BinaryModule` during reverts (such as `0x3fb0ba2e` and `0xd3dea628`) do not match the documented error selectors in the official developer docs or standard ABI catalog.

### Impact
Off-chain applications and SDKs relying strictly on standard ABI decoding cannot decode these custom error selectors, presenting raw hex reverts to users.

### Solution Implemented in Rail
Rail implements an empirical fallback selector lookup map (`EMPIRICAL_SELECTORS`) in `packages/core/src/vault.ts` to decode hex error selectors into user-friendly diagnostic messages.

### Reproduction
```bash
npx tsc-node scripts/selector.ts
```

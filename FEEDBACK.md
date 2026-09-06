# dreamDEX Event Contracts — integration feedback

Four findings from building **Rail** on Shannon against `@somnia-chain/markets-sdk` `0.28.1`. Each one is reproducible by a script in this repository, and each is stated at the confidence the evidence supports: where we observed behaviour but could not identify the cause, we say so rather than guess.

---

## 1. Delegated binary order placement is unreachable

`BinaryPool`'s ABI exposes `placeBinaryOrderFor(address owner, …)`, the binary counterpart to `SpotPool.placeOrderFor`. Calling it from any address other than the order owner reverts.

**Why it cannot be reached.** `OperatorPermissionsRegistry` gates `placeOrderFor` and `cancelOrderFor` on **`SpotPool` only** — the SDK documents `SetOperatorApprovalForPoolParams.pool` as *"SpotPool the grant applies on"*, and the entire operator-grant module lives under `spot/`. There is no mechanism by which any caller can become authorised on a binary pool, so the delegated path exists in the ABI but is unreachable by anyone.

**On the revert selector.** The call reverts with **`0x3fb0ba2e`**. We could not identify which error that is, and we want to be explicit about that rather than assume: the docs' errors page lists `OnlyApprovedContracts()` against this selector, but computing the selector from that signature gives `0xc16ffe21` (see finding 4). `0x3fb0ba2e` matches nothing across the SDK's 422-error catalogue, nothing in openchain, and nothing across those 422 names tried against 15 common parameter shapes. **The revert is reproducible; the error's identity is not something we can confirm.**

**Impact.** A bot cannot trade for a user on Event Contracts without holding their key. The only architecture available today is the one the team recommends — making a contract the order owner — which is what Rail implements.

```bash
npx tsx scripts/delegation.ts
```

---

## 2. A contract order-owner cannot redeem without granting ERC-6909 approval itself

This is the most consequential finding, because it makes the recommended architecture fail *after* a user has already traded.

Redeeming burns the holder's ERC-6909 outcome tokens, so `BinaryMarketsModule` must be an operator on them. Measured on Shannon:

| holder | `isOperator(holder, binaryModule)` |
|---|---|
| an EOA that has traded and redeemed | `true` |
| a freshly deployed contract vault | `false` |

We did not trace how the EOA acquired that approval — plausibly the SDK grants it on first redeem — but the asymmetry is the point: **a contract owner does not get it, and nothing in the documentation says it must grant it.**

**The failure mode is bad.** Orders place and fill correctly. Everything looks healthy. Then every `redeem` reverts with `0xdeda9030` — another selector in no public catalogue — and the winnings are stranded with no error a user or developer could act on. A builder following the "make a contract the order owner" guidance discovers this only after they have money in play.

**Suggested doc change:** state, wherever contract-as-owner is recommended, that the owner must call `outcomeToken.setOperator(binaryModule, true)` before it can redeem.

Rail does this in the vault constructor, as a typed call rather than a low-level one, so a vault that could not redeem fails at deploy rather than losing funds later.

```bash
npx tsx scripts/erc6909.ts
```

---

## 3. An order may not outlive its market — and this is undocumented

Setting `expireTimestampNs` to the window's own remaining time reverts with **`0xd3dea628`**, which appears in neither the errors page, the SDK's catalogue, nor openchain.

Measured on a BTC 300s window with 262s remaining:

| order expiry | result |
|---|---|
| 242s — inside the window | ✅ fills |
| 262s — exactly the remaining time | ❌ `0xd3dea628` |
| 322s — past the window's expiry | ❌ `0xd3dea628` |

**Why this matters more than a typical gotcha:** expiring the order when the window closes is the obvious thing to write. It is what we wrote, and it cost an evening to find, because the selector is undecodable from any public source.

`OrderExpiryBeyondMarket()` exists in the SDK's catalogue and computes to `0xd7b0a759`, so either it is not that error or the deployed signature differs from the SDK's.

```bash
npx tsx scripts/expiry.ts
```

---

## 4. Every selector on the errors documentation page disagrees with its own signature

`docs.dreamdex.io/developers/contracts/errors` lists a 4-byte selector beside each error. We could not match a single one. Computed with viem from the signature given on that same page:

| error | docs page | computed |
|---|---|---|
| `OnlyApprovedContracts()` | `0x3fb0ba2e` | `0xc16ffe21` |
| `ImmediateOrCancelNoFill()` | `0xd48c4403` | `0x8a7da60c` |
| `IncorrectSender(address,address)` | `0xf5e39c1f` | `0x02170f37` |
| `BuilderCodesNotSupported()` | `0x41ec099f` | `0x8cf342de` |
| `PostOnlyWouldCross()` | `0x7cf05fcb` | `0xd99d38f4` |
| `OrderAlreadyExpired()` | `0x3154078e` | `0xcb31835c` |
| `InsufficientBalance(uint256,uint256)` | `0xcf479181` | `0xd145ef82` |

Decoding by **name** works correctly and agrees with the SDK; only the published selector column is wrong. The practical consequence is that anyone debugging a raw revert by looking up its selector in the docs will match the wrong error — or, as with findings 1 and 3, confidently name an error that isn't the one they hit.

```bash
npx tsx scripts/selector.ts
```

---

## One request, not a bug

**Builder fees are disabled on binary pools.** `getMaxBuilderFeeBpsTimes1k()` returns `0` on every Event Contract pool we checked (BTC and ETH at 300s and 900s), and the docs state that a zero cap disables builder codes entirely. The `builderFeeBpsTimes1k` parameter is present on `placeBinaryOrder`, but there is no revenue path behind it.

This hackathon asks for consumer-facing front ends on Event Contracts. Spot has a complete builder-fee system — approvals, per-pool caps, vault accrual. Binary has the parameter and a zero cap, so a third-party client has no way to sustain itself. Raising that cap would make the applications this programme is asking for economically viable.

---

*Everything above is reproducible from this repository against Shannon. Where we could not establish a cause, we have said so rather than fill the gap with a plausible guess — the selector attributions in findings 1 and 3 are exactly the kind of claim that is easy to get wrong and hard to notice.*

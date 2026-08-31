# Rail

**Set the rules your trades must obey. On-chain. Then tap.**

Rail is a policy contract that owns your orders on [dreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts). You fund it once and set your limits. After that a bot can trade for you continuously and unattended — and it cannot exceed those limits, cannot send your money anywhere but back to you, and cannot withdraw. The rules are not in the bot's code. They are in the contract that holds the funds.

There is a Telegram client on top of it, because the point of removing custody is that someone can then tap a button without thinking about it.

Built for the Somnia × dreamDEX Event Contracts Hackathon, on Shannon testnet.

---

## The whole argument, in three transactions

Same bot. Same hot key. Same market. Minutes apart.

```
vault    0x5baC558b7221417cEdEa41D0f574292532f2B59f
owner    0x0bA50b9001b2ECcd3869CC73c07031dca1e11412   (never signed anything)
operator 0x4258950186a12492Bf805f2B9D7facd202921F34   (the bot's hot key)
policy   max/order 5.000  daily 50.000

① the bot trades inside the policy
   1.000 tUSDC → ✅ filled, spent 0.972

② the same bot tries to exceed it
   25.000 tUSDC → ⛔ refused on-chain by max per order
   "That order is 25.000 tUSDC — your per-order limit is 5.000."

③ the bot moves the money — where does it land?
   vault  199.028 → 0.000   (moved 199.028)
   owner  8865.158 → 9064.186   ✅ received everything
   bot    9000.000 → 9000.000   ✅ gained nothing
```

| | transaction |
|---|---|
| ① filled within policy | [`0x428c9b9c…be42`](https://shannon-explorer.somnia.network/tx/0x428c9b9ce8efb5061608c3d6de38b8b100ee462096822a35b37bf78862ecbe42) |
| ② **refused — mined and reverted** | [`0xfe23b0d3…921c`](https://shannon-explorer.somnia.network/tx/0xfe23b0d30dd7c723f50025565b99cbe0861d06ba646d6403156416098c63921c) |
| ③ bot withdraws, owner receives | [`0x2b628760…76f8`](https://shannon-explorer.somnia.network/tx/0x2b6287605f93fcc17ccb35363c023d9f934f729ad23204d3c7dc998191d976f8) |

Reproduce it: `npm run prove`. ② is deliberately broadcast rather than simulated away, so the refusal is a transaction you can open rather than a claim you have to take on trust.

Step ③ is the one worth dwelling on. The bot moved 199 tUSDC and gained nothing, because the withdrawal destination is not a parameter it can pass — it is `owner`, hardcoded, immutable. **The bot can return your money. There is no call it can make that ends with the money anywhere else.**

---

## Why this doesn't already exist

dreamDEX ships an `OperatorPermissionsRegistry` that lets you grant a bot bounded permission to place and cancel orders for you. It gates `SpotPool.placeOrderFor` and `cancelOrderFor`.

It is spot-only. **`BinaryPool` has no operator gate** — confirmed by the team, and visible in the SDK, where `SetOperatorApprovalForPoolParams.pool` is documented as *"SpotPool the grant applies on"* and the whole operator-grant module sits under `spot/`. `placeBinaryOrderFor` exists in the pool's ABI, but calling it from a non-owner reverts; `npm run delegation` reproduces that in ten seconds.

So on Event Contracts today there is no way to let a bot trade for you without handing it the keys. Every autonomous project on this venue works around that, and each picks a different compromise: risk gates written in TypeScript in front of a plain EOA; a human signing every order; a strategy that computes a signal and then stops at dry-run because acting on it unattended isn't safe.

The team's own recommendation is the shape Rail implements:

> *"The shape that works today is making a contract the order owner: it holds the orders and collateral, your bot key only triggers it, and withdrawal stays behind whatever rule you write into it."*

---

## How it works

```
    user's wallet                          the bot's hot key
         │                                        │
         │ signs ONCE                             │ signs every order
         │ (deploy + fund)                        │ (cannot withdraw)
         ▼                                        ▼
   ┌───────────────────────────────────────────────────────┐
   │  RailVault  ── owner: user (immutable)                │
   │             ── operator: bot                          │
   │                                                       │
   │  placeOrder  ▸ cooldown                               │
   │              ▸ expiry headroom                        │
   │              ▸ max notional per order                 │
   │              ▸ rolling 24h cap                        │
   │              ▸ post-check on collateral ACTUALLY spent│
   │  withdraw    ▸ destination hardcoded to owner         │
   │  redeem      ▸ permissionless (only moves value IN)   │
   │  emergencyExit ▸ owner only, no policy checks         │
   └───────────────────────┬───────────────────────────────┘
                           │ the vault is Order.owner
                           ▼
              dreamDEX BinaryPool  ·  ERC-6909 outcomes
                           │
                           ▼
                     OracleHub settles
```

### Policy is checked twice, and the second check is the real one

The cheap pre-check runs on the intended notional, so a refusal can name the rule that fired and the numbers involved. Then the vault measures the collateral that **actually left** — `balanceOf` before and after the pool call — and reverts if that exceeds the limit. Reverting afterwards unwinds the order too.

This matters because a partial fill, a price improvement, or an unexpected charge would all slip past a check on the *intended* amount. In practice orders here routinely fill better than their limit price (1.000 intended, 0.972 spent), and the vault binds on what really moved.

`test_postCheckBindsWhenPoolOvercharges` proves it: a pool that takes 50 tUSDC when the vault intended 1 gets the whole transaction unwound.

### There is deliberately no per-window cap

`placeBinaryOrder` takes no market id, and pools are recycled between windows. Any "window" the operator declared would be a number the vault cannot verify — a dishonest operator would relabel every order as a fresh window and walk straight through the limit. A per-order cap plus a rolling daily cap bound the same exposure and cannot be gamed by relabelling.

Three limits that hold beat four where one is decorative.

---

## In Telegram

```
/link 0xYourAddress     the bot deploys a vault you own, and pays the gas
/fund                   test tUSDC into your vault
/btc                    the live window, with UP / DOWN and three stake sizes
```

A tap produces this, unprompted, seconds apart:

```
Placing UP on BTC · 0.50 tUSDC…

✅ UP on BTC 15-minute filled at 96.4% — 0.49 tUSDC
   Settles when the window closes. I'll tell you.

🎉 UP came in — 1.33 tUSDC is in your vault.
   Claimed for you. /withdraw to send it to your wallet.
```

Nobody signed anything after setup. Fills are **pushed, not polled** — the SDK's live layer watches the chain, so it can attribute a fill to an account, which dreamDEX's public WebSocket feed explicitly cannot. And winnings are claimed **without being asked**, because settled markets vanish from live views and a user who never claims simply forfeits.

When a limit stops a trade, the bot says which one:

> ⛔ **Your max per order rule stopped that.**
> That order is 25.000 tUSDC — your per-order limit is 5.000.
> *The chain refused it, not me.*

---

## Deployed on Shannon (chain 50312)

| | address |
|---|---|
| `RailFactory` | [`0x9dd560a1f2125d730766c9aff2b32e78057a0499`](https://shannon-explorer.somnia.network/address/0x9dd560a1f2125d730766c9aff2b32e78057a0499) |
| `RailVault` (example) | [`0x5baC558b7221417cEdEa41D0f574292532f2B59f`](https://shannon-explorer.somnia.network/address/0x5baC558b7221417cEdEa41D0f574292532f2B59f) |

One vault per user, at a **CREATE2 address that can be shown before it is deployed**, so a signing page displays your vault address while you are still deciding whether to sign. `deployFor` is callable by anyone and the sponsor never becomes the owner — which is how the bot can pay for your first transaction without gaining anything by it.

---

## Status

What is deployed, what is being built, and what was left out on purpose.

**Live and verifiable**
- `RailVault` and `RailFactory`, deployed, 24 Foundry tests passing
- Vault-owned orders filling on the real dreamDEX venue (operator 2)
- Policy refusals mined on-chain as reverted transactions, with decoded, human-readable reasons
- Withdrawal that can only ever reach the owner
- Permissionless redemption, verified 1:1 against `estPayout`
- A transport-agnostic core: discovery, chain-gated tradability, book reads, sizing, execution, settlement
- **Telegram client** — link, fund, trade, status, limits, claim, withdraw
- **Pushed fills**, from the SDK's chain-backed live layer
- **Shared sweeper** — claims settled positions for every user and tells them, and tries `pokeOracle` / `syncSettlement` / `finalizeMarket` on markets stuck with a null outcome before giving up

**In progress**
- Privy signing page, so onboarding is email or Google rather than a pasted address. Somnia uses Privy **global wallets**, so a user who already trades on dreamDEX would arrive with the same address and their existing balance.

**Left out on purpose**
- **No pooled treasury.** Every user deploys their own vault; a bug's blast radius is one person.
- **No custody.** We never hold a user key, and no flow asks for one.
- **No fee on the vault.** Taking a cut would mean a second possible destination for withdrawals, and transaction ③ above stops being true. Builder fees are the right place for this, and they are disabled on binary pools today (see below).

---

## Quickstart

```bash
git clone <this repo> && cd rail
pnpm install
cp .env.example .env      # add a throwaway PRIVATE_KEY
```

```bash
cd contracts && forge test   # 24 tests
cd .. && npm run typecheck   # strict on packages/core
npm run setup                # faucet, deploy factory + vault, fund
npm run loop                 # discover → size → place → position → sweep
npm run prove                # the three transactions above
npm run bot                  # the Telegram client (needs TELEGRAM_BOT_TOKEN)
```

`setup` mints tUSDC from the collateral contract's public `faucet(uint256)`, so onboarding needs no admin and no queue. STT for gas comes from the Somnia faucet bot.

---

## The Event Contracts integration

Rail uses `@somnia-chain/markets-sdk` `0.28.1` across discovery, order books, execution, positions, settlement and the live feed, and calls `BinaryPool` and `BinaryMarketsModule` directly from Solidity for the parts a contract must own.

Things that will bite you, which Rail handles:

| | |
|---|---|
| **A contract owner cannot redeem out of the box** | Redeeming burns your ERC-6909 outcome tokens, so the module must be an operator on them. The SDK grants this for an EOA on its first redeem; a **contract** has to do it itself, and nothing documents that. Orders fill fine and then every redemption reverts, stranding winnings. `RailVault` grants it in its constructor, typed rather than low-level, so a vault that could not redeem would fail at deploy instead of losing funds later. |
| **An order may not outlive its market** | Setting expiry to the window's own remaining time reverts — undocumented, and the obvious thing to write. `orderExpiryFor()` is the single place that computes it. |
| **Venue scoping is mandatory** | Shannon hosts more than one binary venue. Unscoped reads span both and the SDK refuses to guess. Every read is scoped to `OPERATOR_ID` / `VENUE_ID`. |
| **The indexer lags the chain** | Market rows carry a status that trails. Every order is gated on `getMarketOnchain`, never on the indexer. |
| **Book prices are raw integers** | `getBinaryOrderBook(pool, { decimals: 6 })` returns `526000`, meaning 0.526 — not a float. |
| **Read the NO side, don't derive it** | `noBid`/`noAsk` are quoted directly. The complement holds arithmetically, but reconstructing it hides the case where a level is simply absent. |
| **Sub-lot amounts round to zero** | An order for zero is not an order, and a bot that doesn't check looks like it traded while placing nothing. `snapQuantity` throws rather than silently succeeding. |
| **Pools are recycled** | Everything is keyed by `marketId`, never by pool address. |
| **Settled markets vanish** | `getPortfolio` reported zero markets while six settled positions worth 1,160 tUSDC sat unclaimed. Winnings are found through `getClaimable`. |
| **`ImmediateOrCancelNoFill`** | An IOC crossing into a thin book reverts wholesale. Normal on this venue, reported as "nothing filled". |
| **`builderFeeBpsTimes1k` is `uint96`** | Selector-critical. `uint256` reverts with nothing decodable. |
| **`collateral()` is on the Market** | Not the pool: `IBinaryMarket(pool.market()).collateral()`. |

Every value that could silently break — collateral decimals, tick size, lot size, minimum quantity, the status enum — is read from the chain and pinned in config rather than assumed.

---

## Where Rail sits among the other submissions

A strong field, and Rail is not competing with most of it.

**[rampart](https://dorahacks.io/buidl/48111)** measures whether displayed depth can actually be withdrawn. That is trust in the *book*; Rail is trust in the *actor*. They compose.

**[Sigma](https://dorahacks.io/buidl/48086)** computes fair value on-chain from realised volatility and publishes the edge. Its own status page notes the trading bot runs in `DRY_RUN` — which is exactly the wall this repo removes. Sigma decides what a fair price is; Rail is how an agent acts on that answer without being trusted with the money.

**[DreamDesk](https://dorahacks.io/buidl/48194)** builds an auditable trading desk with eight risk gates and a hash-chained ledger. Its gates are, in its own words, `pure TypeScript`, executed by a dedicated desk wallet — a plain EOA. Whoever holds that key can call `placeOrder` directly and every gate is irrelevant. Its roadmap leads with on-chain anchoring "without trusting our server", which is the same problem approached from the other side.

Rail is the missing primitive underneath several of these, not a competitor to them. If it works, they all get better.

---

## Feedback

A separate report covers four findings, each with a script that reproduces it: the unreachable delegated order path, the zero builder-fee cap that leaves consumer front ends with no revenue model, error-selector documentation that does not match the deployed contracts, and the ERC-6909 approval a contract owner must grant itself before it can ever redeem. See [`FEEDBACK.md`](./FEEDBACK.md).

---

## Layout

```
contracts/      RailVault.sol, RailFactory.sol, interfaces, 24 Foundry tests
packages/core/  transport-agnostic: config, markets, sizing, vault, settle, protocolErrors
apps/bot/       Telegram client and the shared sweeper
scripts/        setup, loop, prove, refuse, delegation, verify, venues, portfolio
```

`packages/core` holds no Telegram or HTTP types by design: the clients are thin and the platform they run on is replaceable. If Telegram disappeared tomorrow, every vault, position and limit is untouched on-chain and a different client connects to the same addresses.

## License

MIT

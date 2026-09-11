# Rail — submission notes

## The user story

Ada has traded a little. Event Contracts make sense to her immediately: will BTC be above where it opened when this window closes. Two outcomes, a fixed payout, no leverage, nothing to liquidate.

The problem isn't understanding the market. It's the windows — they close every few minutes, all day, and she has a job. So she looks for something that can act for her, and every option reduces to the same sentence: *paste your private key*. A bot holding her key can trade sizes she'd never choose, at hours she isn't watching, and drain the wallet if it's ever compromised. She closes the tab.

**Rail begins there** — not with a better strategy, but with the reason she can't use one.

She opens the Rail page. It asks for the wallet that should own her vault. She doesn't have one she's willing to use, so she taps **"I don't have one — make me a testnet wallet."** The keypair is generated entirely in her browser; the private key is shown once for her to save and is never transmitted. Rail learns a public address and nothing else.

Then two numbers: at most **5 tUSDC** on any single trade, at most **50 tUSDC** in a day.

One tap carries her into Telegram, and a vault deploys. She signs nothing and pays nothing — `deployFor` is callable by anyone, so Rail covers the gas, and the sponsor never becomes the owner. Her address is written in as the immutable owner; the bot's key is written in as *operator*.

The distinction is the product:

> **Ada owns the vault. The bot only operates it.**

She funds it with 100 tUSDC. The money sits in a contract she owns, not in the bot, and she can open it on the explorer.

Now Telegram is the whole interface.

> **BTC · 5m window**
> Closes in 3m 47s
> Market price — UP **52.6¢**, DOWN **47.4¢**
> Stake: **1.00 tUSDC**

Underneath, the timeframes the venue is actually running — **5m · 15m · 1h · 4h · 1d** — built from live markets, so a button never offers a window that can't be traded. Ada won't be at a screen all afternoon, so she picks **1h** and taps **UP**.

The vault places the order. The bot signs the transaction; it never holds the collateral. Seconds later the fill arrives on its own:

> ✅ **UP** filled on BTC 1h
> Price: **52.6¢**
> Spent: **1.00 tUSDC**

Another day she fat-fingers a stake. What comes back isn't an apology from a bot:

> ⛔ **Policy limit exceeded**
> Requested: **25.000 tUSDC**
> Maximum per order: **5.000 tUSDC**
> *The chain refused it, not me.*

That is not a server-side check or a simulated warning. It is a mined, reverted transaction that anyone can open and read.

When the window closes, Ada does nothing. Settled markets disappear from live views, so a user who never claims simply forfeits — which is why `redeem` on the vault is permissionless and a sweeper collects on her behalf:

> 🎉 **UP** came in — **1.90 tUSDC** is in your vault.

And `/withdraw` sends it home without a signature from her at all. That is safe for a precise reason: the operator *can* invoke the withdrawal path, but the destination is not a parameter it can set — it is hardcoded to the immutable owner. **The bot can return her money. It can never redirect it.**

**Later.** Ada wants something smarter than her own taps. She migrates nothing: the vault accepts any operator address, and only she can change it. She points a pricing model at the same vault, under the same two numbers.

> The software making the decision is not the software that owns the money.

The decision-maker can change. The authorization boundary does not.

### Why the architecture is shaped this way

dreamDEX's operator-permission registry applies to `SpotPool`; the `BinaryPool` path exposes no equivalent delegated gate, so `placeBinaryOrderFor` cannot be reached by any caller. Making the vault itself the order owner is the viable delegated-execution architecture we found for the current interface. `scripts/delegation.ts` reproduces the wall.

Rail also checks policy **twice**: once against the intended order, then authoritatively against the collateral the pool actually spent. If the venue takes more than policy permits, the transaction reverts and the order is unwound. A Foundry test drives exactly that case — a pool taking 50 tUSDC against an intended 1.

Telegram is one client. The primitive underneath is a **user-owned execution boundary for dreamDEX Event Contracts**, and `packages/core` carries no Telegram types precisely so the client stays replaceable.

That matters more than it might sound, because dreamDEX has already committed to the world Rail is built for. Its documentation states that *"autonomous agents and LLMs are first-class participants alongside humans"*, and ships an MCP server, `AGENTS.md`/`SKILL.md` and CCXT-compatible bindings to make that true.

An agent that is a first-class participant still needs a key. Today the only way to let one trade for you is to give it unrestricted control of your funds — which is the same sentence that stopped Ada, with a model on the other end of it instead of a bot. Rail is the missing half of that design: the agent gets execution authority bounded on-chain, and never custody. Swapping Telegram for an MCP-driven agent is a `setOperator` call the owner alone can make; the limits, the refusals and the withdrawal destination do not change.

---

## Against the brief

### A working prototype

Deployed and open on Shannon (chain 50312), not described:

- `RailFactory` [`0x9dd560a1…0499`](https://shannon-explorer.somnia.network/address/0x9dd560a1f2125d730766c9aff2b32e78057a0499) · `RailVault` [`0x5baC558b…B59f`](https://shannon-explorer.somnia.network/address/0x5baC558b7221417cEdEa41D0f574292532f2B59f)
- 24 Foundry tests, including one where a pool takes 50 tUSDC against an intended 1 and the whole transaction unwinds
- Three transactions that demonstrate the security properties rather than assert them: an order filled inside policy, a **mined and reverted** order that exceeded it, and a withdrawal where the operator moved 199 tUSDC and gained nothing
- A live Telegram client and a signing page

`npm run prove` reproduces all three from a clean checkout.

### Integration with Event Contracts

Rail doesn't sit beside Event Contracts — the vault *is* the order owner. It holds and spends its own collateral, receives ERC-6909 outcome tokens, and redeems through `BinaryMarketsModule` at settlement.

That last part surfaced a gap worth reporting: a contract owner cannot redeem at all until it grants the module ERC-6909 operator approval itself. An EOA gets that automatically; a contract doesn't, and nothing documents it. Orders fill perfectly and then every redemption reverts, stranding the winnings. Rail grants it in the constructor.

The product also depends on a mechanic most integrations ignore: two opposite-side buyers pair without a seller, because the pool mints a complete set from their combined collateral. That's why a one-tap consumer app on this venue can promise a fill at all.

### Meaningful use of the APIs and SDK

`@somnia-chain/markets-sdk` `0.28.1` across the whole lifecycle — market discovery, on-chain status gating, order books, execution, positions, settlement — plus its chain-backed live layer for push notifications. dreamDEX's public WebSocket is market data only and explicitly does not attribute fills to an account; the SDK's live layer watches the chain, so it can, and that's what makes a fill arrive on its own.

Every value that fails silently is read from the chain rather than assumed: collateral decimals, tick and lot size, minimum quantity, the status enum, and the venue scope.

### A clear and intuitive user experience

Two taps in an app she already has open. No wallet extension, no seed phrase, no signature per trade, no claiming, and no order book to read — the book is stated as a price, not as a forecast: *"Market price — UP 35.3¢, DOWN 64.7¢."*

When something fails it says why, in words: *"No one was there to take the other side."* *"That window closes too soon to be worth entering."* Protocol reverts are decoded into sentences rather than shown as hex.

### Adoption, trading activity, and ecosystem impact

Rail places real orders on the live dreamDEX venue — a venue quiet enough that any genuine flow is a visible share of it.

The wider point is that the operator is a parameter. Several projects in this hackathon compute a signal — a fair value, a council vote, a risk score — and then stop, because on Event Contracts there is no way to act on one unattended without surrendering custody. `SpotPool` has an operator-permission registry; `BinaryPool` has none. Rail is that boundary, and it does not care who is doing the deciding.

Finally, [`FEEDBACK.md`](./FEEDBACK.md) documents four protocol-level findings with scripts that reproduce each: the unreachable delegated order path, the undocumented rule that an order may not outlive its market, error-selector documentation that disagrees with the deployed contracts, and the ERC-6909 approval above. Those apply to anyone building this shape, not only to us.

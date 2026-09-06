# Rail — submission notes

## The user story

Ada has traded a little. She opens dreamDEX, finds Event Contracts, and understands them immediately: will BTC be above where it opened when this five-minute window closes. Two outcomes, fixed payout, no leverage, nothing to liquidate. It's the first thing in crypto that has read like a straight question.

The problem is the windows. They close every five minutes, all day. Taking positions means sitting in front of a book, and she has a job.

So she looks for something that can act for her. Every option comes down to the same sentence: *paste your private key*. A bot with her key can do anything her key can do — trade sizes she'd never choose, at hours she isn't watching, and empty the wallet if it's ever compromised. She closes the tab.

**This is where Rail begins.** Not with a better strategy, but with the reason she can't use one.

Ada opens Rail, enters the wallet that should own her vault, and sets two numbers: at most **5 tUSDC** on any single trade, at most **50 tUSDC** in a day. One tap deploys a contract that she owns and we pay for. She never signs anything.

From then on she's in Telegram. `/btc` shows the live window — how long is left, what the market currently implies, three stake sizes. She taps **UP**. A few seconds later the fill arrives on its own: *"UP on BTC 15-minute filled at 96.4% — 0.49 tUSDC."* When the window closes, the position is claimed for her without being asked, because settled markets vanish from live views and a user who never claims simply forfeits. *"UP came in — 1.33 tUSDC is in your vault."*

One afternoon she fat-fingers a stake. The reply isn't an apology from a bot:

> **Your max per order rule stopped that.** That order is 25.000 tUSDC — your per-order limit is 5.000. *The chain refused it, not me.*

That refusal is a real transaction. She can open it.

And when she wants her money, `/withdraw` sends it to her wallet — the only address it can reach, because the destination isn't a parameter the bot can set.

**The second act.** Months later Ada wants something smarter than her own taps. Rail doesn't ask her to migrate: the vault takes any operator address. She points a pricing model at the same vault, under the same two numbers. The thing deciding changed. The thing enforcing didn't.

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

Two taps in an app she already has open. No wallet extension, no seed phrase, no signature per trade, no claiming, and no order book to read — the market's view is stated in English: *"Market says 35.3% chance it closes above where it opened."*

When something fails it says why, in words: *"No one was there to take the other side."* *"That window closes too soon to be worth entering."* Protocol reverts are decoded into sentences rather than shown as hex.

### Adoption, trading activity, and ecosystem impact

Rail places real orders on the live dreamDEX venue — a venue quiet enough that any genuine flow is a visible share of it.

The wider point is that the operator is a parameter. Several projects in this hackathon compute a signal — a fair value, a council vote, a risk score — and then stop, because on Event Contracts there is no way to act on one unattended without surrendering custody. `SpotPool` has an operator-permission registry; `BinaryPool` has none. Rail is that boundary, and it does not care who is doing the deciding.

Finally, [`FEEDBACK.md`](./FEEDBACK.md) documents four protocol-level findings with scripts that reproduce each: the unreachable delegated order path, the undocumented rule that an order may not outlive its market, error-selector documentation that disagrees with the deployed contracts, and the ERC-6909 approval above. Those apply to anyone building this shape, not only to us.

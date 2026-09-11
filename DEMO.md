# Demo script — 2:30

Five beats. The bot is already live on Render, so most of this is you using Telegram.

**Record in your own voice.** The organisers answered that directly: AI narration isn't disqualifying, human is preferred.

---

## Before you start

**Do not run the bot locally.** It is running on Render. Two processes polling one token makes Telegram hand each message to whichever asked first, and it presents as the bot randomly ignoring you — mid-recording. Check first:

```bash
pgrep -f "apps/bot/src/index" || echo "clear — Render is the only poller"
```

Then fund the vault, because `prove` ends by emptying it:

```bash
npx tsx scripts/fund.ts
```

Have open: Telegram, the Shannon explorer, a terminal, and https://web-rho-drab-21.vercel.app

**Fallback hashes** if anything stalls live — all mined today, all openable:

| | |
|---|---|
| filled order | `0xa550f455c402c94b06026a5cebc0b438d0b110736375fef2a730bc189e225347` |
| refusal (mined revert) | `0xe97ec56eee58e451940a23151efa0902de7170fec54301f54730e851e09c79c4` |
| withdrawal to owner | `0x7ae29fed19dfab9ba79f1d50fe3e23236b42c04f91d4097e74848a2de3cafc2f` |

---

## Beat 1 — the gap (0:00–0:25)

**Screen:** terminal.

> "dreamDEX lets you give a bot permission to trade for you. That's `placeOrderFor`, gated by an operator registry — and it only covers spot markets.
>
> On Event Contracts there is no equivalent. So today, letting anything trade Event Contracts for you means handing it your private key."

```bash
npx tsx scripts/delegation.ts
```

Let the revert land. Say *"the delegated path is in the ABI and no caller can reach it."* Don't read the selector aloud.

> "Every project here that automates Event Contracts had to solve this. Rail is what you get when you solve it without taking custody."

---

## Beat 2 — no wallet, no problem (0:25–0:55)

**Screen:** the signing page.

> "Rail is the permission layer. Your funds sit in a vault you own; an operator only gets bounded authority to act through it."

Show, in order:
- tap **"I don't have one — make me a testnet wallet"** — the key appears
- say it plainly: *"generated in my browser. It is never sent to the bot or the server."*
- limits: **5** per order, **50** per day
- tap through to Telegram

Landing message — pause on it:

```
Vault ready.
0x5baC…B59f — owned by you, not by us.
Owner: 0x0bA5…1412
Operator: this bot — execution only.
Limits: 5.00 per order, 50.00 a day.
```

> "I signed nothing and paid nothing. Rail covered the deploy, and the vault is still mine."

---

## Beat 3 — a real order (0:55–1:25)

`/fund`, then `/btc`.

> "These timeframes are the windows actually live on the venue right now — five minutes through a day."

Tap **1h**, then **UP**.

```
BTC · 1h window
Closes in 46m 26s
Market price — UP 23.6¢, DOWN 76.4¢
Stake: 1.00 tUSDC
```

Let the fill arrive on its own:

```
✅ UP filled on BTC 1h
Price: 23.6¢
Spent: 0.97 tUSDC
```

> "A real order on the real venue. The vault placed it and the vault owns it — the bot never touched the collateral."

---

## Beat 4 — the refusal (1:25–2:00) — **this is the shot**

Slow down. This is what separates Rail from every other bounded-vault submission in the field.

> "Same bot, same key, same market. Now it asks for twenty-five."

Tap the **5.00** stake, then tap it again past the cap — or run `npm run prove`.

```
⛔ Policy limit exceeded

Requested: 25.000 tUSDC
Maximum per order: 5.000 tUSDC

The chain refused it, not me.
```

Then **open the reverted transaction in the explorer.** Let it sit on screen for a beat.

> "The chain refused it. Not the bot's code — the contract holding the money. A mined, reverted transaction anyone can open.
>
> And the check that binds isn't the one on the request. It's the second one, against the collateral the pool actually spent — so if the venue takes more than the policy allows, the whole transaction unwinds."

---

## Beat 5 — the money comes back (2:00–2:20)

`/withdraw`.

> "When the bot moves funds, there is exactly one place they can go."

```
vault  99.04 → 0.00
owner  received everything
bot    gained nothing
```

> "The destination isn't a parameter the bot can set. It's the owner, hardcoded. The bot can return my money. It can never redirect it."

---

## Close (2:20–2:30)

> "Rail doesn't decide what an operator should do. It decides what an operator is allowed to do.
>
> Today that operator is a Telegram bot. It could be an agent, a pricing model, a strategy you wrote — one owner-only call, same limits. dreamDEX says autonomous agents are first-class participants. Rail is what makes one bounded."

Last frame: repo URL and factory address.

---

## What to cut if you're over

Beat 1 to fifteen seconds. Beat 2's wallet generation to a single tap. **Never cut beat 4.**

## Things that will hurt

- Don't demo `/btc` → tap → success and stop. That reads as a Telegram wrapper, and Telegram is the crowded lane.
- Don't call a price a probability. It's `23.6¢` — what the book charges, not a forecast.
- Don't say "Spent: 1.29" is a payout. It's the collateral that left the vault.
- Don't name `0x3fb0ba2e` or `0xd3dea628`. Say what they do, not what they are.
- Don't claim non-custodial unqualified. Say *only the owner address can receive a withdrawal* — exactly true, and provable on screen.
- Don't claim developers can point vaults at their own operator. The factory's operator is immutable; the **owner** repoints their vault with `setOperator`.

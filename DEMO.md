# Demo script — 2:30

Four beats. Nothing here needs new code; every shot is a command you already have.

**Record in your own voice.** The organisers answered that directly: AI narration isn't disqualifying, human is preferred.

**Record while testnet is healthy.** Settlement has been stalling intermittently all week — markets finalising with a null outcome, oracle gaps of ~50 minutes. Get the footage banked; don't film on the 8th.

---

## Before you start

```bash
npx tsx scripts/fund.ts        # prove.ts ends by emptying the vault
npm run bot                    # separate terminal, leave running
```

Have open: a terminal, Telegram, and Shannon explorer.

---

## Beat 1 — the gap (0:00–0:25)

**Screen:** the dreamDEX docs page for operator permissions, then your terminal.

> "dreamDEX lets you give a bot permission to trade for you. That's `placeOrderFor`, gated by an operator registry — and it only works on spot markets.
>
> On Event Contracts there's no equivalent. So today, letting anything trade Event Contracts for you means handing it your private key."

```bash
npx tsx scripts/delegation.ts
```

Let the revert land on screen. Don't name the error — say *"the delegated path is in the ABI, and no caller can reach it."*

---

## Beat 2 — the boundary (0:25–1:10)

**Screen:** Telegram, phone-sized.

> "Rail is the missing piece. A contract owns the orders and the collateral. The bot only gets permission to act through it, inside limits you set."

Show, in order:
- the signing page: address, max per trade **5**, daily **50**
- the Telegram deep link landing → *"Vault ready — owned by you, not by us"*
- `/btc`, then tap **UP**
- the fill arriving on its own: *"✅ UP on BTC filled at …"*

> "That's a real order on the real venue. The vault placed it and the vault owns it."

---

## Beat 3 — the refusal (1:10–1:50) — **this is the shot**

Slow down here. This is the twenty seconds that separates Rail from every other submission.

> "Now the same bot, same key, same market — asking for twenty-five."

Tap the **5.00** stake repeatedly until the daily cap trips, or run:

```bash
npm run prove
```

On screen:

```
⛔ REFUSED ON-CHAIN by max per order
"That order is 25.000 tUSDC — your per-order limit is 5.000."
```

Then **open the reverted transaction in the explorer**. Let it sit there.

> "The chain refused it. Not the bot's code — the contract holding the money. This is a mined, reverted transaction you can open yourself."

---

## Beat 4 — the money comes back (1:50–2:15)

> "And when the bot moves funds, there's only one place they can go."

From the `prove` output already on screen:

```
vault  199.028 → 0.000
owner  8865.158 → 9064.186   ✅ received everything
bot    9000.000 → 9000.000   ✅ gained nothing
```

> "The bot moved a hundred and ninety-nine tUSDC and gained nothing. The destination isn't a parameter it can set — it's the owner, hardcoded."

---

## Close (2:15–2:30)

> "Rail doesn't decide what an operator should do. It decides what an operator is allowed to do.
>
> Today that operator is a Telegram bot you tap. It could be a pricing model, or an agent, or a strategy you wrote — two projects in this hackathon compute a signal and then stop, because on Event Contracts nobody can act on one unattended.
>
> Rail is the boundary they'd plug into."

Last frame: the repo URL and the factory address.

---

## What to cut if you're over

Beat 1 to fifteen seconds — the gap can be asserted and evidenced in the README. **Never cut beat 3.**

## Things that will hurt

- Don't demo `/btc` → tap → success and stop. That reads as a Telegram wrapper.
- Don't say "stake known prices" or invent terminology — say *take a position on an Event Contract*.
- Don't name `0x3fb0ba2e` or `0xd3dea628`. Say what they do, not what they are.
- Don't claim non-custodial without qualification. Say *only the owner address can withdraw* — that's exactly true and provable.

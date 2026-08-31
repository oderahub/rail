"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

const EXPLORER = "https://shannon-explorer.somnia.network";
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "rail_somnia_bot";
const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-8)}`;

export default function Page() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [maxPerOrder, setMax] = useState("5");
  const [dailyCap, setDaily] = useState("50");

  const address = wallets[0]?.address ?? (user?.wallet?.address as string | undefined);

  // No API route, and no key on the host. The bot already deploys vaults and
  // pays for them; this page just carries the user's address and chosen limits
  // across in the deep-link payload. Telegram allows 64 chars of [A-Za-z0-9_-].
  const payload = address ? `${address}-${maxPerOrder}-${dailyCap}` : "";
  const deepLink = `https://t.me/${BOT}?start=${payload}`;

  if (!ready) return <main className="wrap"><p className="muted">…</p></main>;

  // ── logged in ──────────────────────────────────────────────────────────────
  if (authenticated && address) {
    return (
      <main className="wrap">
        <p className="eyebrow">Step 2 of 3</p>
        <h1>Set your limits</h1>
        <p className="muted">
          These go into the contract itself, not into the bot's code. Once they're set, nothing
          the bot does can exceed them — the chain refuses the transaction.
        </p>

        <div className="card">
          <div className="row"><span className="k">Your wallet</span><span className="v">{short(address)}</span></div>
          <label htmlFor="mx">Most it can stake on one trade (tUSDC)</label>
          <input id="mx" inputMode="decimal" value={maxPerOrder} onChange={(e) => setMax(e.target.value)} />
          <label htmlFor="dc">Most it can stake in a day (tUSDC)</label>
          <input id="dc" inputMode="decimal" value={dailyCap} onChange={(e) => setDaily(e.target.value)} />
        </div>

        <a href={deepLink}>
          <button>Create my vault in Telegram →</button>
        </a>
        <p className="muted small" style={{ marginTop: 12 }}>
          You won't be asked to sign or pay anything. We deploy the vault and cover the gas,
          and it is yours regardless of who paid for it.
        </p>
        <button className="ghost" style={{ marginTop: 18 }} onClick={logout}>Use a different account</button>
      </main>
    );
  }

  // ── landing ────────────────────────────────────────────────────────────────
  return (
    <main className="wrap">
      <p className="eyebrow">Step 1 of 3</p>
      <h1>Rail</h1>
      <p>Set the rules your trades must obey. On-chain. Then tap.</p>
      <p className="muted">
        Rail puts your money in a contract you own and a bot can only reach through the limits
        you set. It cannot exceed them, cannot send your money anywhere but back to you, and
        cannot withdraw.
      </p>

      <div className="card steps">
        <h2>What happens next</h2>
        <div className="row"><span className="k">1</span><span className="v">Sign in — email or Google, no wallet app needed</span></div>
        <div className="row"><span className="k">2</span><span className="v">Choose your limits</span></div>
        <div className="row"><span className="k">3</span><span className="v">We deploy your vault and pay for it</span></div>
      </div>

      <button onClick={login}>Continue</button>
      <p className="muted small" style={{ marginTop: 14 }}>
        Somnia uses shared wallets, so if you already trade on dreamDEX you'll arrive with the
        same address and the same balance.
      </p>
    </main>
  );
}

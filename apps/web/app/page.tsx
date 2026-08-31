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
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState<string | null>(null);
  const [existed, setExisted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const address = wallets[0]?.address ?? (user?.wallet?.address as string | undefined);

  async function createVault() {
    if (!address) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, maxPerOrder: Number(maxPerOrder), dailyCap: Number(dailyCap) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed");
      setVault(d.vault); setExisted(Boolean(d.alreadyExisted));
    } catch (e: any) {
      setErr(e?.message ?? "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <main className="wrap"><p className="muted">…</p></main>;

  // ── done ───────────────────────────────────────────────────────────────────
  if (vault) {
    return (
      <main className="wrap">
        <p className="eyebrow">Step 3 of 3</p>
        <h1>Your vault is live</h1>
        <p className="muted">
          {existed ? "You already had one — here it is." : "Deployed, and we paid the gas. You own it."}
        </p>

        <div className="card">
          <div className="row"><span className="k">Vault</span>
            <a className="v" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">{short(vault)}</a></div>
          <div className="row"><span className="k">Owner</span><span className="v">{short(address!)}</span></div>
          <div className="row"><span className="k">Most per trade</span><span className="v">{maxPerOrder} tUSDC</span></div>
          <div className="row"><span className="k">Most per day</span><span className="v">{dailyCap} tUSDC</span></div>
        </div>

        <p className="muted small">
          Only <span className="mono">{short(address!)}</span> can withdraw from it. The bot that trades
          for you can place orders inside those limits and send funds back to you — nothing else.
        </p>

        <a href={`https://t.me/${BOT}?start=${vault}`}>
          <button>Open the bot and start trading →</button>
        </a>
        <p className="muted small" style={{ marginTop: 14 }}>
          In Telegram, send <span className="mono">/link {address}</span> and then <span className="mono">/fund</span>.
        </p>
      </main>
    );
  }

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

        {err && <p className="err small">{err}</p>}

        <button onClick={createVault} disabled={busy}>
          {busy ? "Creating your vault…" : "Create my vault"}
        </button>
        <p className="muted small" style={{ marginTop: 12 }}>
          You won't be asked to sign or pay anything — we cover the deployment, and the vault
          is yours regardless of who paid for it.
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

      <div className="card">
        <h2>What happens next</h2>
        <div className="row"><span className="k">1</span><span className="v" style={{ textAlign: "left" }}>Sign in — email or Google, no wallet app needed</span></div>
        <div className="row"><span className="k">2</span><span className="v" style={{ textAlign: "left" }}>Choose your limits</span></div>
        <div className="row"><span className="k">3</span><span className="v" style={{ textAlign: "left" }}>We deploy your vault and pay for it</span></div>
      </div>

      <button onClick={login}>Continue</button>
      <p className="muted small" style={{ marginTop: 14 }}>
        Somnia uses shared wallets, so if you already trade on dreamDEX you'll arrive with the
        same address and the same balance.
      </p>
    </main>
  );
}

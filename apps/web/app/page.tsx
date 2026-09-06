"use client";

import { useState } from "react";

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "rail_somnia_bot";
const EXPLORER = "https://shannon-explorer.somnia.network";
const isAddress = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a.trim());

export default function Page() {
  const [address, setAddress] = useState("");
  const [maxPerOrder, setMax] = useState("5");
  const [dailyCap, setDaily] = useState("50");

  const ok = isAddress(address);
  // the bot deploys the vault and pays for it; this page only carries the
  // address and limits across in the deep-link payload
  const deepLink = `https://t.me/${BOT}?start=${address.trim()}-${maxPerOrder}-${dailyCap}`;

  return (
    <main className="wrap">
      <p className="eyebrow">Somnia × dreamDEX</p>
      <h1>Rail</h1>
      <p>Set the rules your trades must obey. On-chain. Then tap.</p>
      <p className="muted">
        Rail puts your money in a contract you own and a bot can only reach through the limits
        you set. It cannot exceed them, cannot send your money anywhere but back to you, and
        cannot withdraw.
      </p>

      <div className="card">
        <h2>Set your limits</h2>
        <p className="muted small" style={{ marginTop: -4 }}>
          These go into the contract itself, not the bot's code. Once set, nothing the bot does
          can exceed them — the chain refuses the transaction.
        </p>

        <label htmlFor="addr">The wallet that will own your vault</label>
        <input
          id="addr"
          placeholder="0x…"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
        />
        {address && !ok && <p className="err small" style={{ marginTop: 6 }}>That doesn't look like an address.</p>}

        <label htmlFor="mx">Most it can stake on one trade (tUSDC)</label>
        <input id="mx" inputMode="decimal" value={maxPerOrder} onChange={(e) => setMax(e.target.value)} />

        <label htmlFor="dc">Most it can stake in a day (tUSDC)</label>
        <input id="dc" inputMode="decimal" value={dailyCap} onChange={(e) => setDaily(e.target.value)} />
      </div>

      {ok ? (
        <a href={deepLink}>
          <button>Create my vault in Telegram →</button>
        </a>
      ) : (
        <button disabled>Create my vault in Telegram →</button>
      )}

      <p className="muted small" style={{ marginTop: 14 }}>
        You won't be asked to sign or pay anything. We deploy the vault and cover the gas, and
        it is yours regardless of who paid for it — only the address above can ever withdraw.
      </p>

      <div className="card" style={{ marginTop: 30 }}>
        <h2>Already deployed</h2>
        <div className="row">
          <span className="k">Factory</span>
          <a className="v" href={`${EXPLORER}/address/0x9dd560a1f2125d730766c9aff2b32e78057a0499`} target="_blank" rel="noreferrer">
            0x9dd560a1…0499
          </a>
        </div>
        <div className="row">
          <span className="k">Source</span>
          <a className="v" href="https://github.com/oderahub/rail" target="_blank" rel="noreferrer">
            github.com/oderahub/rail
          </a>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "rail_somnia_bot";
const EXPLORER = "https://shannon-explorer.somnia.network";
const isAddress = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a.trim());

export default function Page() {
  const [address, setAddress] = useState("");
  const [maxPerOrder, setMax] = useState("5");
  const [dailyCap, setDaily] = useState("50");
  const [made, setMade] = useState<{ pk: string; addr: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Generated in the browser and never transmitted. The bot is told the
   * address only — which is the whole point of Rail: nobody but you ever
   * holds the key that can withdraw.
   */
  function makeWallet() {
    const pk = generatePrivateKey();
    const addr = privateKeyToAccount(pk).address;
    setMade({ pk, addr });
    setAddress(addr);
    setCopied(false);
  }

  const ok = isAddress(address);
  // the bot deploys the vault and pays for it; this page only carries the
  // address and limits across in the deep-link payload
  const deepLink = `https://t.me/${BOT}?start=${address.trim()}-${maxPerOrder}-${dailyCap}`;

  return (
    <main className="wrap">
      <p className="eyebrow">Somnia × dreamDEX</p>
      <h1>Rail</h1>
      <p>The permission layer for delegated Event Contract execution.</p>
      <p className="muted">
        Let a bot, an agent or an application act on your dreamDEX positions without giving it
        ownership of your funds. Your collateral and your orders live in a vault you own. An
        operator gets bounded authority to act through it — never custody, and never a
        destination it can choose.
      </p>
      <p className="muted small">
        dreamDEX has an operator-permission registry for <code>SpotPool</code>. <code>BinaryPool</code>{" "}
        has none, so on Event Contracts there is no way to let anything trade for you without
        handing over your private key. Rail is the missing boundary. The Telegram bot below is one
        client — the vault accepts any operator, and only you can change which.
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

        {!made && (
          <button className="ghost" style={{ marginTop: 10 }} onClick={makeWallet}>
            I don't have one — make me a testnet wallet
          </button>
        )}

        {made && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, background: "var(--surface-2)" }}>
            <p className="small" style={{ margin: "0 0 8px" }}>
              <strong>Save this private key.</strong> It is the only thing that can withdraw from
              your vault. It was generated in your browser and never sent to us — if you lose it,
              nobody can recover it.
            </p>
            <p className="mono small" style={{ wordBreak: "break-all", margin: "0 0 10px", color: "var(--ink-2)" }}>
              {made.pk}
            </p>
            <button
              className="ghost"
              onClick={() => { navigator.clipboard?.writeText(made.pk); setCopied(true); }}
            >
              {copied ? "Copied ✓" : "Copy private key"}
            </button>
            <p className="small muted" style={{ margin: "10px 0 0" }}>
              Shannon testnet only. Import it into MetaMask to withdraw, or just watch the vault
              on the explorer.
            </p>
          </div>
        )}

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
      <p className="muted small" style={{ marginTop: 10 }}>
        No testnet funds needed: any address works, and <code>/fund</code> mints test tUSDC
        straight into your vault. Shannon testnet — nothing here touches real money.
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

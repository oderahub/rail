import { Bot, InlineKeyboard, type Context } from "grammy";
import { isAddress, formatUnits } from "viem";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import {
  cfg, fmt, scale, exchange, liveWindows, pickWindow, intervalsFor, isTradable, book,
  crossingPrice, quantityForSpend, notional, orderExpiryFor, SubLotError, NoLiquidityError,
  deployVault, faucetInto, existingVault, vaultState, placeOrder, withdrawAll,
  claimableFor, sweep, outcomeBalance, pub, operator, type Policy,
} from "../../../packages/core/src/index.js";
import { getUser, putUser, allUsers, isNewFill, primeSeen } from "./store.js";
import { startSweeper } from "./sweeper.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing — talk to @BotFather, then put it in .env");

const bot = new Bot(token);
const client: any = (exchange() as any).client;

const DEFAULT_POLICY: Policy = {
  maxNotionalPerOrder: 5_000_000n,  // 5 tUSDC
  dailyCap: 50_000_000n,            // 50 tUSDC
  cooldownSecs: 0,
  minExpiryHeadroom: 30,
};
const STAKES = [500_000n, 1_000_000n, 5_000_000n]; // 0.5 / 1 / 5 tUSDC
const tx = (h: string) => `${cfg.explorer}/tx/${h}`;
const addr = (a: string) => `${cfg.explorer}/address/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ── window card ──────────────────────────────────────────────────────────────

/** 300 -> "5m", 3600 -> "1h", 86400 -> "1d" */
const tfLabel = (sec: number) =>
  sec < 3600 ? `${sec / 60}m` : sec < 86400 ? `${sec / 3600}h` : `${sec / 86400}d`;

const countdown = (secs: number) => {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  const m = Math.floor(secs / 60), sx = secs % 60;
  return `${m}m ${String(sx).padStart(2, "0")}s`;
};

const DEFAULT_TF = 300;

/** An order-book price, shown as a price. 747000 -> "74.7¢". Deliberately not
 *  narrated as a probability: it is what the book charges, not a forecast. */
const cents = (raw: bigint) => `${(Number(raw) / Number(scale) * 100).toFixed(1)}¢`;

/**
 * `explicit` is the difference between "show me a window" and "show me THAT
 * window". /btc and /eth express a preference; tapping 1h is a choice.
 *
 * 5m and 15m both roll on the quarter hour, so they disappear together for a
 * moment while the next pair is created and indexed. A preference falls back to
 * the shortest window that is actually live; an explicit tap still says the
 * chosen one is closed rather than silently trading a different book.
 */
async function windowCard(asset: string, stake: bigint, tf = DEFAULT_TF, explicit = false) {
  let w = await pickWindow(asset, 75, tf);
  let substituted = false;
  if (!w && !explicit) {
    w = await pickWindow(asset, 75);
    substituted = w !== null;
  }
  const offered = await intervalsFor(asset);

  // the timeframe row is built from what the venue is actually running, so a
  // button never offers a window that cannot be traded
  const tfRow = (kb: InlineKeyboard, current: number) => {
    for (const s of offered) kb.text(s === current ? `▸${tfLabel(s)}` : tfLabel(s), `tf:${asset}:${stake}:${s}`);
    return kb;
  };

  if (!w) {
    const kb = tfRow(new InlineKeyboard(), tf).row().text("↻", `card:${asset}:${stake}:${DEFAULT_TF}`);
    return {
      text: `No ${asset} *${tfLabel(tf)}* window is open right now.` +
            (offered.length ? `\n\nOpen timeframes: ${offered.map(tfLabel).join(", ")}` : ""),
      kb,
    };
  }

  const b = await book(w.pool);
  const up = b.yesAsk?.price;

  const text =
    `*${asset} · ${tfLabel(w.intervalSec)} window*` +
    (substituted ? `\n_The ${tfLabel(tf)} window is rolling — showing the next one up._` : "") +
    `\n\n` +
    `Closes in *${countdown(w.secsLeft)}*\n` +
    (up !== undefined
      ? `Market price — UP *${cents(up)}*, DOWN *${cents(scale - up)}*\n\n`
      : `_No one is quoting the UP side right now — a tap may not fill._\n\n`) +
    `Stake: *${fmt(stake, 2)} tUSDC*`;

  const kb = new InlineKeyboard()
    .text("📈 UP", `bet:${asset}:up:${stake}:${w.intervalSec}`)
    .text("📉 DOWN", `bet:${asset}:down:${stake}:${w.intervalSec}`)
    .row();
  for (const st of STAKES) kb.text(st === stake ? `▸${fmt(st, 2)}` : fmt(st, 2), `stake:${asset}:${st}:${w.intervalSec}`);
  kb.row();
  tfRow(kb, w.intervalSec);
  kb.row()
    .text("↻", `card:${asset}:${stake}:${w.intervalSec}`)
    .text(asset === "BTC" ? "→ ETH" : "→ BTC", `card:${asset === "BTC" ? "ETH" : "BTC"}:${stake}:${w.intervalSec}`);

  return { text, kb };
}

// ── commands ─────────────────────────────────────────────────────────────────

const toRaw = (v: string, dflt: bigint): bigint => {
  const n = Number(v.replace("_", "."));
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : dflt;
};

/**
 * Deploy a vault the user owns and remember who they are.
 * Shared by /link and by the signing page's deep-link payload — the page never
 * deploys anything itself, which is why no key has to live on the web host.
 */
async function linkVault(c: Context, owner: `0x${string}`, policy: Policy) {
  const tgId = String(c.from!.id);
  const vault = await deployVault(owner, policy);

  // watchUser hydrates history; prime AFTER it settles and register the user
  // LAST, or the notifier pushes their entire past at them
  await client.watchUser(vault).catch(() => {});
  for (let i = 0; i < 10; i++) {
    const n = (client.getLiveUserFills(null, vault, { limit: 500 }) ?? []).length;
    await new Promise((r) => setTimeout(r, 300));
    if ((client.getLiveUserFills(null, vault, { limit: 500 }) ?? []).length === n) break;
  }
  primeSeen((client.getLiveUserFills(null, vault, { limit: 500 }) ?? []).map((f: any) => String(f.id)), tgId);
  putUser(tgId, owner, vault);

  await c.reply(
    "Vault ready.\n\n[" + short(vault) + "](" + addr(vault) + ") \u2014 owned by *you*, not by us.\n\n" +
      "Owner: `" + owner + "`\nOperator: this bot \u2014 execution only.\n\n" +
      "Limits: *" + fmt(policy.maxNotionalPerOrder, 2) + "* per order, *" + fmt(policy.dailyCap, 2) + "* a day.\n\n" +
      "Now fund it: send tUSDC to the vault, or tap /fund for test tokens.",
    { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
  );
}

bot.command("start", async (c) => {
  // the signing page sends 0xADDRESS-maxPerOrder-dailyCap
  const payload = (c.match ?? "").trim();
  // the page sends a decimal as 2_5, because Telegram forbids "." here
  const m = payload.match(/^(0x[a-fA-F0-9]{40})-([0-9._]+)-([0-9._]+)$/);
  if (m && !getUser(String(c.from!.id))) {
    await c.reply("Setting up your vault\u2026");
    try {
      await linkVault(c, m[1] as `0x${string}`, {
        ...DEFAULT_POLICY,
        maxNotionalPerOrder: toRaw(m[2], DEFAULT_POLICY.maxNotionalPerOrder),
        dailyCap: toRaw(m[3], DEFAULT_POLICY.dailyCap),
      });
      const card = await windowCard("BTC", STAKES[0]);
      return void c.reply(card.text, { parse_mode: "Markdown", reply_markup: card.kb });
    } catch (e: any) {
      return void c.reply("Could not set that up: " + (e?.shortMessage ?? e?.message));
    }
  }

  const u = getUser(String(c.from!.id));
  if (!u) {
    // Someone arriving from a link with no wallet cannot proceed on /link alone.
    // The page generates a keypair in the browser; the bot never sees a key.
    const kb = cfg.webUrl
      ? new InlineKeyboard().url("Create a wallet & set limits", cfg.webUrl)
      : undefined;
    return c.reply(
      "*Rail*\n\n" +
        "Set the rules your trades must obey. On-chain. Then tap.\n\n" +
        "Rail puts your funds in a vault *you* own. This bot can execute within the limits you set — it cannot exceed them, and it cannot redirect your funds anywhere but back to you.\n\n" +
        (cfg.webUrl
          ? "No wallet yet? Tap below — the page makes one in your browser and never sends the key to us.\n\nAlready have one:\n`/link 0xYourAddress`"
          : "To begin, send me the wallet address that should own your vault:\n`/link 0xYourAddress`"),
      { parse_mode: "Markdown", reply_markup: kb }
    );
  }
  const { text, kb } = await windowCard("BTC", STAKES[0]);
  await c.reply(text, { parse_mode: "Markdown", reply_markup: kb });
});

bot.command("link", async (c) => {
  const owner = (c.match ?? "").trim();
  if (!isAddress(owner)) return c.reply("Send it as `/link 0xYourAddress`.", { parse_mode: "Markdown" });

  await c.reply("Deploying your vault…");
  try {
    await linkVault(c, owner as `0x${string}`, DEFAULT_POLICY);
  } catch (e: any) {
    await c.reply(`Could not deploy: ${e?.shortMessage ?? e?.message}`);
  }
});

bot.command("fund", async (c) => {
  const u = getUser(String(c.from!.id));
  if (!u) return c.reply("Link a wallet first: /link 0xYourAddress");
  // `/fund 20` used to be accepted silently and then ignored, minting 100
  const asked = Number((c.match ?? "").toString().replace(/[^0-9.]/g, ""));
  const amount = Number.isFinite(asked) && asked > 0 ? BigInt(Math.round(Math.min(asked, 1000) * 1e6)) : 100_000_000n;
  await c.reply(`Minting *${fmt(amount, 2)} tUSDC* into your vault…`, { parse_mode: "Markdown" });
  try {
    const h = await faucetInto(u.vault, amount);
    const st = await vaultState(u.vault);
    await c.reply(`Funded. Vault holds *${fmt(st.collateral, 2)} tUSDC*.\n[transaction](${tx(h)})`, {
      parse_mode: "Markdown", link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    await c.reply(`Funding failed: ${e?.shortMessage ?? e?.message}`);
  }
});

bot.command(["btc", "eth"], async (c) => {
  const asset = c.message!.text!.slice(1, 4).toUpperCase();
  const { text, kb } = await windowCard(asset, STAKES[0]);
  await c.reply(text, { parse_mode: "Markdown", reply_markup: kb });
});

bot.command("status", async (c) => {
  const u = getUser(String(c.from!.id));
  if (!u) return c.reply("Link a wallet first: /link 0xYourAddress");
  const st = await vaultState(u.vault);
  const claim = await claimableFor(u.vault);
  const owed = claim.reduce((a, x) => a + x.estPayout, 0n);

  const lines = [
    `*Your vault*`,
    `[${short(u.vault)}](${addr(u.vault)})`,
    ``,
    `Balance: *${fmt(st.collateral, 2)} tUSDC*`,
    `Spent today: ${fmt(st.spentToday, 2)} of ${fmt(st.policy.dailyCap, 2)}`,
    st.halted ? `\n⏸ *Trading halted*` : ``,
    owed > 0n ? `\nWaiting to be claimed: *${fmt(owed, 2)} tUSDC* — /claim` : ``,
    ``,
    `Owner: \`${u.owner}\``,
    `_Only that address can withdraw. This bot cannot._`,
  ];
  await c.reply(lines.filter(Boolean).join("\n"), { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
});

bot.command("limits", async (c) => {
  const u = getUser(String(c.from!.id));
  if (!u) return c.reply("Link a wallet first: /link 0xYourAddress");
  const st = await vaultState(u.vault);
  await c.reply(
    `*Your limits — enforced on-chain*\n\n` +
      `Most per trade: *${fmt(st.policy.maxNotionalPerOrder, 2)} tUSDC*\n` +
      `Most per day: *${fmt(st.policy.dailyCap, 2)} tUSDC*\n` +
      `Left today: *${fmt(st.remainingToday, 2)} tUSDC*\n` +
      `Cooldown: ${st.policy.cooldownSecs}s\n` +
      `Won't enter a window closing within ${st.policy.minExpiryHeadroom}s\n\n` +
      `_These live in your vault contract. If this bot tried to break one, the chain would reject it._`,
    { parse_mode: "Markdown" }
  );
});

bot.command("claim", async (c) => {
  const u = getUser(String(c.from!.id));
  if (!u) return c.reply("Link a wallet first: /link 0xYourAddress");
  await c.reply("Claiming settled positions…");
  const r = await sweep(u.vault);
  await c.reply(
    r.claimed === 0
      ? "Nothing to claim yet."
      : `Claimed *${r.claimed}* position${r.claimed === 1 ? "" : "s"}, worth *${fmt(r.total, 2)} tUSDC*.` +
        (r.stuck.length ? `\n\n${r.stuck.length} market(s) haven't settled yet — I'll keep trying.` : ""),
    { parse_mode: "Markdown" }
  );
});

bot.command("withdraw", async (c) => {
  const u = getUser(String(c.from!.id));
  if (!u) return c.reply("Link a wallet first: /link 0xYourAddress");
  const st = await vaultState(u.vault);
  if (st.collateral === 0n) return c.reply("Vault is empty.");
  await c.reply(`Sending *${fmt(st.collateral, 2)} tUSDC* to your wallet…`, { parse_mode: "Markdown" });
  try {
    const h = await withdrawAll(u.vault);
    await c.reply(
      `Sent to \`${u.owner}\`.\n[transaction](${tx(h)})\n\n_I can only ever send it there._`,
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    );
  } catch (e: any) {
    await c.reply(`Withdrawal failed: ${e?.shortMessage ?? e?.message}`);
  }
});

// ── taps ─────────────────────────────────────────────────────────────────────

bot.callbackQuery(/^(card|stake|tf):(BTC|ETH):(\d+):(\d+)$/, async (c) => {
  const [, verb, asset, stake, tf] = c.match!;
  const { text, kb } = await windowCard(asset, BigInt(stake), Number(tf), verb === "tf");
  await c.answerCallbackQuery();
  await c.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb }).catch(() => {});
});

bot.callbackQuery(/^bet:(BTC|ETH):(up|down):(\d+):(\d+)$/, async (c) => {
  const [, asset, dir, stakeStr, tfStr] = c.match!;
  const stake = BigInt(stakeStr);
  const tf = Number(tfStr);
  const u = getUser(String(c.from.id));
  if (!u) { await c.answerCallbackQuery({ text: "Link a wallet first: /link", show_alert: true }); return; }

  await c.answerCallbackQuery({ text: `${dir === "up" ? "UP" : "DOWN"} · ${fmt(stake, 2)} tUSDC` });

  try {
    // need room for the vault's expiry-headroom rule AND a margin below the
    // market's own expiry — an order must not outlive the market it trades
    const st = await vaultState(u.vault);
    if (st.collateral < stake) {
      return void c.reply(
        `Your vault holds *${fmt(st.collateral, 2)} tUSDC* — not enough for a ${fmt(stake, 2)} stake.\n\n` +
          `Tap /fund for test tokens, or send tUSDC to \`${u.vault}\`.`,
        { parse_mode: "Markdown" }
      );
    }

    const w = await pickWindow(asset, 75, tf);
    if (!w) return void c.reply(`That ${tfLabel(tf)} window is too close to closing. Tap ↻ for the next one.`);
    if (!(await isTradable(w.id))) return void c.reply("That market has locked. Tap ↻ for the next one.");

    const b = await book(w.pool);
    // DOWN is BUY_NO, priced off the NO ask the book actually quotes
    const kind = dir === "up" ? ORDER_KIND.BUY_YES : ORDER_KIND.BUY_NO;
    const price = crossingPrice(dir === "up" ? b.yesAsk?.price : b.noAsk?.price);
    const qty = quantityForSpend(stake, price);

    // Acknowledge before the receipt. placeOrder waits for it, and the live
    // layer pushes the fill the moment it lands — so replying afterwards puts
    // the confirmation BEHIND the fill. Say it now; let the fill complete it.
    await c.reply(
      `Placing *${dir === "up" ? "UP" : "DOWN"}* on ${asset} ${tfLabel(w.intervalSec)} · ${fmt(stake, 2)} tUSDC…`,
      { parse_mode: "Markdown" }
    );

    const r = await placeOrder(u.vault, {
      pool: w.pool, kind, price, quantity: qty,
      expireTimestampNs: orderExpiryFor(w),
      orderType: ORDER_TYPE.MARKET,
    });

    if (r.ok && (r.spent ?? 0n) > 0n) {
      // the pushed fill carries price and size; this only proves it landed,
      // so the user is never left watching "Placing…" if the push is slow
      await c.reply(
        `Order placed — *${fmt(r.spent!, 2)} tUSDC* left your vault.` +
          (r.txHash ? `\n[transaction](${tx(r.txHash)})` : ""),
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
      );
    } else if (r.ok) {
      // mined, but nothing crossed: a market order against an empty side
      // spends nothing and emits no fill, which used to look like a hang
      await c.reply(
        `That went through, but nothing filled — no one was on the other side at that price.\n\n` +
          `_Your money did not move._ Tap ↻ for the next window, or try the other side.`,
        { parse_mode: "Markdown" }
      );
    } else if (r.refusedBy) {
      await c.reply(
        `⛔ *Policy limit exceeded*\n\n` +
          (r.detail
            ? `Requested: *${fmt(r.detail.asked, 3)} tUSDC*\n${r.detail.label}: *${fmt(r.detail.limit, 3)} tUSDC*\n\n`
            : `${r.reason}\n\n`) +
          `_The chain refused it, not me._`,
        { parse_mode: "Markdown" }
      );
    } else {
      await c.reply(`That didn't go through.\n\n_${r.reason ?? "unknown"}_`, { parse_mode: "Markdown" });
      console.error(`[order failed] asset=${asset} dir=${dir} stake=${stake} pool=${w.pool} secsLeft=${w.secsLeft} reason=${r.reason}`);
    }
  } catch (e: any) {
    if (e instanceof SubLotError) return void c.reply("That stake is too small for this market's minimum.");
    if (e instanceof NoLiquidityError) return void c.reply("Nothing resting on that side right now. Tap ↻ and try again.");
    await c.reply(`Something went wrong: ${e?.shortMessage ?? e?.message}`);
  }
});

// ── push: fills arrive on their own ──────────────────────────────────────────

async function startLive() {
  const ws = await liveWindows();
  for (const w of ws) await client.watchMarket(w.pool).catch(() => {});
  for (const u of allUsers()) await client.watchUser(u.vault).catch(() => {});

  // pool -> "BTC 5-minute", refreshed as windows roll
  let poolNames = new Map<string, string>();
  const refreshNames = async () => {
    poolNames = new Map((await liveWindows()).map((w) => [w.pool.toLowerCase(), `${w.asset} ${tfLabel(w.intervalSec)}`]));
  };
  await refreshNames();
  setInterval(refreshNames, 60_000).unref?.();

  client.subscribeLive(async () => {
    for (const u of allUsers()) {
      const fills = client.getLiveUserFills(null, u.vault, { limit: 20 }) ?? [];
      for (const f of fills) {
        if (!isNewFill(String(f.id), u.tgId)) continue;
        const px = f.fillPrice ? cents(BigInt(f.fillPrice)) : "";
        // quoteQuantity is collateral SPENT (quantity x fillPrice), not a payout.
        // Labelling it loosely invites the reader to mistake it for winnings.
        const spent = f.quoteQuantity
          ? `${Number(formatUnits(BigInt(f.quoteQuantity), cfg.decimals)).toFixed(2)} tUSDC`
          : "";
        // takerSide is the side the user bought (BUY_YES / BUY_NO). `kind` is the
        // MATCH type — MINT_A_PAIR, DIRECT_YES — and reading it reported every
        // paired DOWN fill as UP, because "MINT_A_PAIR" contains no "NO".
        const side = String(f.takerSide ?? "").includes("NO") ? "DOWN" : "UP";
        const where = poolNames.get(String(f.pool).toLowerCase()) ?? "";
        await bot.api
          .sendMessage(
            u.tgId,
            `✅ *${side}* filled${where ? ` on ${where}` : ""}` +
              (px ? `\nPrice: *${px}*` : "") +
              (spent ? `\nSpent: *${spent}*` : "") +
              (f.txHash ? `\n[transaction](${tx(f.txHash)})` : "") +
              `\n\n_Settles when the window closes. I'll tell you._`,
            { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
          )
          .catch(() => {});
      }
    }
  });
  console.log(`live: watching ${ws.length} markets, ${allUsers().length} vaults`);
}

bot.catch((e) => console.error("bot error:", e));

// ── boot ─────────────────────────────────────────────────────────────────────

/**
 * Everything here is best-effort. A hosted bot that answers /start with stale
 * market data is worth far more than one that refuses to boot because the
 * indexer blinked, so nothing below is allowed to abort startup.
 */
async function preflight() {
  console.log(`operator: ${operator.address}`);
  if (!cfg.factory) console.error("FATAL-ish: FACTORY_ADDRESS unset — /link will fail for everyone");
  if (!cfg.venueId) console.error("warning: VENUE_ID unset — market lookups may pick the wrong venue");
  try {
    const gas = await pub.getBalance({ address: operator.address });
    const stt = Number(gas) / 1e18;
    console.log(`gas: ${stt.toFixed(3)} STT`);
    if (stt < 0.5) console.error(`LOW GAS: ${stt.toFixed(3)} STT — deploys and orders will start failing`);
  } catch (e: any) {
    console.error("could not read gas balance:", e?.shortMessage ?? e?.message);
  }
}

await preflight();

await bot.api.setMyCommands([
  { command: "start", description: "Begin" },
  { command: "btc", description: "Trade the BTC window" },
  { command: "eth", description: "Trade the ETH window" },
  { command: "status", description: "Your vault" },
  { command: "limits", description: "Your on-chain limits" },
  { command: "claim", description: "Collect settled winnings" },
  { command: "withdraw", description: "Send funds to your wallet" },
]).catch((e) => console.error("setMyCommands failed (continuing):", e?.message));

await startLive().catch((e) => {
  console.error("live layer failed to start (continuing without pushed fills):", e?.message);
});
startSweeper(bot);

// A redeploy that does not stop the old long-poll session leaves two instances
// on one token, and Telegram 409s the newcomer. Stop cleanly on both signals.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    console.log(`${sig} — stopping`);
    void bot.stop();
  });
}

console.log("Rail bot up.");
bot.start();

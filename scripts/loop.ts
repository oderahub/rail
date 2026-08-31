/**
 * Day 3 exit criterion: the whole loop with no bot involved.
 * discover → gate on chain → size → place → position → sweep
 */
import {
  cfg, fmt, pickWindow, isTradable, book, crossingPrice, quantityForSpend, notional,
  expiryNs, existingVault, vaultState, placeOrder, outcomeBalance, claimableFor, sweep,
} from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import { privateKeyToAccount } from "viem/accounts";

const step = (s: string) => console.log(`\n▸ ${s}`);
const owner = cfg.ownerAddress ?? privateKeyToAccount(cfg.operatorKey).address;
const SPEND = 500_000n; // 0.5 tUSDC — a "tap"

step("vault");
const vault = await existingVault(owner);
if (!vault) throw new Error("no vault for this owner — run scripts/wire.ts first");
const st = await vaultState(vault);
console.log(`  ${vault}`);
console.log(`  collateral ${fmt(st.collateral)}   spent today ${fmt(st.spentToday)}   remaining ${fmt(st.remainingToday)}   halted=${st.halted}`);
console.log(`  policy: max/order ${fmt(st.policy.maxNotionalPerOrder)}  daily ${fmt(st.policy.dailyCap)}  cooldown ${st.policy.cooldownSecs}s  headroom ${st.policy.minExpiryHeadroom}s`);

step("pick a window");
const w = await pickWindow("BTC");
if (!w) throw new Error("no tradable BTC window right now");
console.log(`  BTC ${w.intervalSec}s — ${w.secsLeft}s left — pool ${w.pool}`);
console.log(`  on-chain tradable: ${await isTradable(w.id)}`);

step("book");
const b = await book(w.pool);
console.log(`  yesBid ${b.yesBid ? fmt(b.yesBid.price) : "—"}   yesAsk ${b.yesAsk ? fmt(b.yesAsk.price) : "—"}`);

step("size a 0.5 tUSDC tap");
const price = crossingPrice(b.yesAsk?.price);
const qty = quantityForSpend(SPEND, price);
console.log(`  price ${fmt(price)}  qty ${fmt(qty)} contracts  notional ${fmt(notional(price, qty))}`);

step("place through the vault");
const r = await placeOrder(vault, {
  pool: w.pool, kind: ORDER_KIND.BUY_YES, price, quantity: qty,
  expireTimestampNs: orderExpiryFor(w), orderType: ORDER_TYPE.MARKET,
});
if (r.ok) console.log(`  ✅ filled, spent ${fmt(r.spent!)}\n  ${cfg.explorer}/tx/${r.txHash}`);
else console.log(`  ${r.refusedBy ? `⛔ refused by ${r.refusedBy}` : "❌ failed"} — ${r.reason}`);

step("position");
console.log(`  vault holds ${fmt(await outcomeBalance(vault, w.yesTokenId))} YES on this window`);

step("sweep anything already settled");
const c = await claimableFor(vault);
console.log(`  claimable: ${c.length}`);
if (c.length) {
  const s = await sweep(vault);
  console.log(`  claimed ${s.claimed}, worth ${fmt(s.total)}${s.stuck.length ? `, ${s.stuck.length} stuck` : ""}`);
}
process.exit(0);

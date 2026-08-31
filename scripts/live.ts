/**
 * Can we PUSH fills to a user instead of polling?
 * dreamDEX's public WS is market-data only and does not attribute fills to an
 * account. The SDK's live layer watches the chain, so it does.
 */
import {
  cfg, fmt, exchange, liveWindows, existingVault, placeOrder,
  book, crossingPrice, quantityForSpend, expiryNs,
} from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";

const c: any = (exchange() as any).client;
const vault = (await existingVault(cfg.ownerAddress!))!;
const ws = await liveWindows();
const w = ws.find((x) => x.asset === "BTC" && x.secsLeft > 120) ?? ws[0];

console.log(`vault  ${vault}`);
console.log(`market ${w.asset} ${w.intervalSec}s  pool ${w.pool}\n`);

console.log("▸ opening watches");
await c.watchMarket(w.pool);
await c.watchUser(vault);

// "unwatched" reads return empty, which is how you tell it from an empty book
for (let i = 0; i < 20; i++) {
  const s = c.getWatchStatus(w.pool);
  process.stdout.write(`\r  status: ${s}      `);
  if (s === "live") break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log();

let events = 0;
const unsub = c.subscribeLive(() => { events++; });

console.log("\n▸ placing an order while the watch is open");
const b = await book(w.pool);
const price = crossingPrice(b.yesAsk?.price);
const qty = quantityForSpend(700_000n, price);
const r = await placeOrder(vault, {
  pool: w.pool, kind: ORDER_KIND.BUY_YES, price, quantity: qty,
  expireTimestampNs: expiryNs(120), orderType: ORDER_TYPE.MARKET,
});
console.log(`  ${r.ok ? `✅ filled, spent ${fmt(r.spent!)}` : `❌ ${r.reason}`}`);

console.log("\n▸ did the live store see it? (5s)");
await new Promise((rr) => setTimeout(rr, 5000));

const fills = c.getLiveUserFills(null, vault, { limit: 10 });
if (fills[0]) console.log("  raw LiveFill fields:", Object.keys(fills[0]).join(", "));
const orders = c.getLiveUserOrders(w.pool, vault, { limit: 10 });
console.log(`  store change callbacks: ${events}`);
console.log(`  live user fills:  ${fills.length}`);
for (const f of fills.slice(0, 5))
  console.log(`    ${f.kind ?? ""} price ${f.price} qty ${f.quantity} block ${f.blockNumber ?? "?"}`);
console.log(`  live user orders: ${orders.length}`);
for (const o of orders.slice(0, 5))
  console.log(`    id ${String(o.orderId ?? o.id).slice(0, 20)} status ${o.status} filled ${o.filled ?? "?"}`);

unsub?.();
c.stopLive();
process.exit(0);

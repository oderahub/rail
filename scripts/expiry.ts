/** Does an order that expires at/after its market get rejected? */
import { cfg, fmt, pickWindow, book, crossingPrice, quantityForSpend, expiryNs,
         existingVault, placeOrder } from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";

const vault = (await existingVault(cfg.ownerAddress!))!;
const w = (await pickWindow("BTC", 90))!;
const b = await book(w.pool);
const price = crossingPrice(b.yesAsk?.price);
const qty = quantityForSpend(500_000n, price);
console.log(`window: ${w.asset} ${w.intervalSec}s, ${w.secsLeft}s left\n`);

for (const [label, secs] of [
  ["well inside the window", Math.max(35, w.secsLeft - 20)],
  ["exactly the window's remaining time", w.secsLeft],
  ["past the window's expiry", w.secsLeft + 60],
] as const) {
  const r = await placeOrder(vault, {
    pool: w.pool, kind: ORDER_KIND.BUY_YES, price, quantity: qty,
    expireTimestampNs: expiryNs(secs), orderType: ORDER_TYPE.MARKET,
  });
  console.log(`${String(secs).padStart(4)}s (${label})`);
  console.log(`      ${r.ok ? `✅ filled ${fmt(r.spent!)}` : `❌ ${r.reason}`}\n`);
}
process.exit(0);

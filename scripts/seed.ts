import { cfg, fmt, liveWindows, book, crossingPrice, quantityForSpend, expiryNs,
         existingVault, placeOrder, vaultState } from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";

const vault = (await existingVault(cfg.ownerAddress!))!;
console.log(`vault ${vault}`);
const ws = (await liveWindows()).filter((w) => w.secsLeft > 75).sort((a, b) => a.secsLeft - b.secsLeft);
const w = ws[0];
console.log(`${w.asset} ${w.intervalSec}s — settles in ${w.secsLeft}s`);

const b = await book(w.pool);
const price = crossingPrice(b.yesAsk?.price);
const r = await placeOrder(vault, {
  pool: w.pool, kind: ORDER_KIND.BUY_YES, price,
  quantity: quantityForSpend(1_000_000n, price),
  expireTimestampNs: expiryNs(Math.max(35, Math.min(w.secsLeft - 20, 240))),
  orderType: ORDER_TYPE.MARKET,
});
console.log(r.ok ? `✅ filled ${fmt(r.spent!)} — ${cfg.explorer}/tx/${r.txHash}` : `❌ ${r.reason}`);
console.log(`\nsettles in ~${Math.ceil(w.secsLeft / 60)} min. The sweeper will claim it and message you.`);
process.exit(0);

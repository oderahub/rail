/**
 * Demo shot #2 — the chain refusing a trade the operator wanted to make.
 * Same bot, same key, same market. The only thing stopping it is the vault.
 */
import {
  cfg, fmt, pickWindow, book, crossingPrice, quantityForSpend, notional, orderExpiryFor,
  existingVault, vaultState, placeOrder,
} from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import { privateKeyToAccount } from "viem/accounts";

const owner = cfg.ownerAddress ?? privateKeyToAccount(cfg.operatorKey).address;
const vault = (await existingVault(owner))!;
const st = await vaultState(vault);
const w = (await pickWindow("BTC"))!;
const b = await book(w.pool);
const price = crossingPrice(b.yesAsk?.price);

console.log(`vault ${vault}`);
console.log(`per-order limit: ${fmt(st.policy.maxNotionalPerOrder)} tUSDC\n`);

for (const spend of [1_000_000n, 25_000_000n]) {
  const qty = quantityForSpend(spend, price);
  const n = notional(price, qty);
  const label = n > st.policy.maxNotionalPerOrder ? "OVER THE LIMIT" : "within limit";
  console.log(`── attempting ${fmt(n)} tUSDC  (${label})`);

  const r = await placeOrder(vault, {
    pool: w.pool, kind: ORDER_KIND.BUY_YES, price, quantity: qty,
    expireTimestampNs: orderExpiryFor(w), orderType: ORDER_TYPE.MARKET,
  });

  if (r.ok) {
    console.log(`   ✅ filled — spent ${fmt(r.spent!)}`);
    console.log(`   ${cfg.explorer}/tx/${r.txHash}\n`);
  } else if (r.refusedBy) {
    console.log(`   ⛔ REFUSED ON-CHAIN by: ${r.refusedBy}`);
    console.log(`   "${r.reason}"\n`);
  } else {
    console.log(`   ❌ ${r.reason}\n`);
  }
}
process.exit(0);

/**
 * The security properties, demonstrated on-chain rather than asserted.
 * Same bot key throughout. Nothing here is mocked.
 */
import {
  cfg, fmt, pickWindow, book, crossingPrice, quantityForSpend, notional, orderExpiryFor,
  existingVault, vaultState, placeOrder, placeOrderOnChain, withdrawAll, pub, operator,
} from "../packages/core/src/index.js";
import { ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import { parseAbi, formatUnits } from "viem";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const bal = (a: `0x${string}`) =>
  pub.readContract({ address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

const owner = cfg.ownerAddress!;
const vault = (await existingVault(owner))!;
const st = await vaultState(vault);
const w = (await pickWindow("BTC"))!;
const b = await book(w.pool);
const price = crossingPrice(b.yesAsk?.price);

console.log(`vault    ${vault}`);
console.log(`owner    ${owner}   (never signed anything)`);
console.log(`operator ${operator.address}   (the bot's hot key)`);
console.log(`policy   max/order ${fmt(st.policy.maxNotionalPerOrder)}  daily ${fmt(st.policy.dailyCap)}\n`);

const place = async (spend: bigint, onChain = false) => {
  const qty = quantityForSpend(spend, price);
  const n = notional(price, qty);
  const fn = onChain ? placeOrderOnChain : placeOrder;
  const r = await fn(vault, {
    pool: w.pool, kind: ORDER_KIND.BUY_YES, price, quantity: qty,
    expireTimestampNs: orderExpiryFor(w), orderType: ORDER_TYPE.MARKET,
  });
  return { n, r };
};

console.log("① the bot trades inside the policy");
{
  const { n, r } = await place(1_000_000n);
  console.log(`   ${fmt(n)} tUSDC → ${r.ok ? `✅ filled, spent ${fmt(r.spent!)}` : `❌ ${r.reason}`}`);
  if (r.txHash) console.log(`   ${cfg.explorer}/tx/${r.txHash}`);
}

console.log("\n② the same bot tries to exceed it");
{
  const { n, r } = await place(25_000_000n, true); // broadcast, so the revert is clickable
  console.log(`   ${fmt(n)} tUSDC → ${r.refusedBy ? `⛔ refused on-chain by ${r.refusedBy}` : r.ok ? "✅ filled (!!)" : `❌ ${r.reason}`}`);
  if (r.reason && r.refusedBy) console.log(`   "${r.reason}"`);
  if (r.txHash) console.log(`   reverted on-chain: ${cfg.explorer}/tx/${r.txHash}`);
}

console.log("\n③ the bot moves the money — where does it land?");
{
  const [ownerBefore, botBefore, vaultBefore] = await Promise.all([bal(owner), bal(operator.address), bal(vault)]);
  const hash = await withdrawAll(vault);
  const [ownerAfter, botAfter, vaultAfter] = await Promise.all([bal(owner), bal(operator.address), bal(vault)]);
  const moved = vaultBefore - vaultAfter;
  console.log(`   vault  ${fmt(vaultBefore)} → ${fmt(vaultAfter)}   (moved ${fmt(moved)})`);
  console.log(`   owner  ${fmt(ownerBefore)} → ${fmt(ownerAfter)}   ${ownerAfter - ownerBefore === moved ? "✅ received everything" : "❌"}`);
  console.log(`   bot    ${fmt(botBefore)} → ${fmt(botAfter)}   ${botAfter === botBefore ? "✅ gained nothing" : "❌ BOT GAINED FUNDS"}`);
  console.log(`   ${cfg.explorer}/tx/${hash}`);
}

console.log(`
The bot placed orders, was refused by the chain when it overstepped, and could
move funds only to the user. There is no call it can make that ends with the
money anywhere else — the destination is not a parameter.`);
process.exit(0);

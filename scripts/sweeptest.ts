import { cfg, fmt, existingVault, vaultState, claimableFor, sweep } from "../packages/core/src/index.js";

const vault = (await existingVault(cfg.ownerAddress!))!;
const before = await vaultState(vault);
console.log(`vault ${vault}`);
console.log(`balance before: ${fmt(before.collateral, 2)} tUSDC\n`);

const pending = await claimableFor(vault);
console.log(`claimable positions: ${pending.length}`);
for (const p of pending)
  console.log(`  ${p.outcomeIdx === 0 ? "UP  " : "DOWN"}  held ${fmt(p.amount, 2)}  pays ${fmt(p.estPayout, 2)}${p.voided ? "  (VOIDED)" : ""}`);

if (pending.length === 0) { console.log("\nnothing to sweep yet"); process.exit(0); }

console.log("\nsweeping…");
const r = await sweep(vault);
console.log(`\nclaimed ${r.claimed}, worth ${fmt(r.total, 2)} tUSDC`);
for (const s of r.settled) {
  const side = s.outcomeIdx === 0 ? "UP" : "DOWN";
  console.log(`  ${s.voided ? "↩️ VOID" : s.won ? "🎉 WON " : "📉 LOST"}  ${side}  ${fmt(s.payout, 2)} tUSDC`);
}
for (const s of r.stuck) console.log(`  ⏳ stuck ${s.marketId.slice(0, 14)}… ${s.reason.slice(0, 90)}`);

const after = await vaultState(vault);
console.log(`\nbalance after: ${fmt(after.collateral, 2)} tUSDC  (+${fmt(after.collateral - before.collateral, 2)})`);
process.exit(0);

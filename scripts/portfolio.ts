import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const me = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`).address;
const ex = new SomniaMarkets({
  indexerUrl: process.env.INDEXER_URL!,
  chain: somniaShannon,
  wsRpcUrl: process.env.WS_RPC_URL!,
  addresses: SOMNIA_TESTNET_ADDRESSES,
} as any);
const c: any = (ex as any).client;

const p = await c.getPortfolio(me).catch((e: any) => {
  console.log("getPortfolio:", e?.shortMessage ?? e?.message); return null;
});
if (p) {
  console.log("portfolio keys:", Object.keys(p).join(", "));
  const mk = p.markets ?? [];
  console.log(`\nmarkets touched: ${mk.length}`);
  let realized = 0, open = 0;
  for (const m of mk.slice(0, 40)) {
    const r = Number(m.realizedPnl ?? m.realized ?? 0) / 1e6;
    const u = Number(m.unrealizedPnl ?? m.unrealized ?? 0) / 1e6;
    realized += r; open += u;
    console.log(`  ${String(m.symbol ?? m.marketAddress).slice(0, 34).padEnd(34)} realized ${r.toFixed(3).padStart(9)}  open ${u.toFixed(3).padStart(9)}  status ${m.status ?? "?"}`);
  }
  console.log(`\nTOTAL realized: ${realized.toFixed(2)} tUSDC   open: ${open.toFixed(2)} tUSDC`);
}

const claim = await c.getClaimable(me).catch((e: any) => {
  console.log("\ngetClaimable:", e?.shortMessage ?? e?.message); return null;
});
if (claim) {
  const rows = Array.isArray(claim) ? claim : (claim.positions ?? []);
  console.log(`\nCLAIMABLE (settled, awaiting redeem): ${rows.length}`);
  for (const r of rows.slice(0, 20))
    console.log("  ", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)).slice(0, 200));
}
process.exit(0);

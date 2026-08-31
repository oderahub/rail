import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { cfg } from "../packages/core/src/config.js";
import { liveWindows } from "../packages/core/src/markets.js";

const pub = createPublicClient({ chain: somniaShannon as any, transport: http(cfg.rpcUrl) });
const poolAbi = parseAbi([
  "function getMaxBuilderFeeBpsTimes1k() view returns (uint256)",
  "function getBuilderApproval(address user, address builder) view returns (uint256)",
]);

console.log("=== Do builder fees work on BINARY pools? ===");
const ws = await liveWindows();
for (const w of ws.slice(0, 4)) {
  try {
    const max = await pub.readContract({ address: w.pool, abi: poolAbi, functionName: "getMaxBuilderFeeBpsTimes1k" }) as bigint;
    console.log(`  ${w.asset} ${String(w.intervalSec).padStart(6)}s  maxBuilderFeeBpsTimes1k = ${max}  →  ${max === 0n ? "❌ builder codes DISABLED on this pool" : `✅ up to ${Number(max) / 1000} bps`}`);
  } catch (e: any) {
    console.log(`  ${w.asset} ${w.intervalSec}s  ERROR ${e?.shortMessage ?? e?.message}`);
  }
}

console.log("\n=== Does dreamDEX provision a smart wallet for our addresses? ===");
for (const [label, addr] of [["owner", cfg.ownerAddress!], ["operator", "0x4258950186a12492Bf805f2B9D7facd202921F34"]] as const) {
  for (const base of ["https://stg.api.dreamdex.io", "https://api.dreamdex.io"]) {
    try {
      const r = await fetch(`${base}/v0/wallets/${addr}/smart-wallets`);
      const body = await r.text();
      console.log(`  ${label} @ ${base.replace("https://","")}: ${r.status} ${body.slice(0, 160)}`);
    } catch (e: any) {
      console.log(`  ${label} @ ${base.replace("https://","")}: ${e?.message?.slice(0, 80)}`);
    }
  }
}
process.exit(0);

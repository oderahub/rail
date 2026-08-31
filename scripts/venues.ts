import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const ex = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
} as any);
const c: any = (ex as any).client;

const live = await c.listLiveBinaryMarkets({ limit: 50 });
const byVenue = new Map<string, any[]>();
for (const m of live) {
  const k = `op=${m.operatorId}  venue=${m.venueId}`;
  (byVenue.get(k) ?? byVenue.set(k, []).get(k)!).push(m);
}
const ops = await c.listOperators({ limit: 30 });
const ownerOf = new Map(ops.map((o: any) => [o.operatorId, o.owner]));

for (const [k, ms] of byVenue) {
  const opId = Number(k.match(/op=(\d+)/)![1]);
  console.log(`\n${k}`);
  console.log(`  owner: ${ownerOf.get(opId)}`);
  console.log(`  markets (${ms.length}): ${ms.map((m: any) => `${m.asset}/${m.intervalSec}s`).join(", ")}`);
  const vol = ms.reduce((a: number, m: any) => a + Number(m.cumulativeQuoteVolume ?? 0), 0);
  const trades = ms.reduce((a: number, m: any) => a + Number(m.tradeCount ?? 0), 0);
  console.log(`  cumulative quote volume: ${vol.toLocaleString()}   trades: ${trades.toLocaleString()}`);
}
process.exit(0);

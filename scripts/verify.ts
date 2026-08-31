/**
 * Day 0 — pin every value that silently breaks things, and probe whether
 * a random dev can create their own venue/series.
 * Read-only without a key. Set PRIVATE_KEY to exercise faucet + preflights.
 */
import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const INDEXER = "https://dev.smk.somnia.host/v1/graphql";
const WS = "wss://api.infra.testnet.somnia.network/ws";

const line = (s: string) => console.log(`\n${"─".repeat(70)}\n${s}\n${"─".repeat(70)}`);
const methods = (o: any) => {
  if (!o) return [];
  const keys = [...new Set([
    ...Object.keys(o),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(o) ?? {}),
  ])];
  return keys.filter((k) => {
    try { return typeof o[k] === "function"; } catch { return false; }
  }).sort();
};

async function main() {
  const pk = process.env.PRIVATE_KEY?.trim();

  const exchange = new SomniaMarkets({
    indexerUrl: INDEXER,
    chain: somniaShannon,
    wsRpcUrl: WS,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    ...(pk ? { privateKey: pk as `0x${string}` } : {}),
  } as any);

  line("ADDRESSES (SOMNIA_TESTNET_ADDRESSES)");
  console.log(JSON.stringify(SOMNIA_TESTNET_ADDRESSES, null, 2));

  line("API SURFACE");
  console.log("exchange:", methods(exchange).join(", "));
  console.log("\nexchange.client:", methods((exchange as any).client).join(", "));
  if (pk) console.log("\nexchange.trader:", methods((exchange as any).trader).join(", "));

  line("LIVE BINARY MARKETS ON SHANNON");
  const client: any = (exchange as any).client;
  const live = await client.listLiveBinaryMarkets({ limit: 25 });
  console.log(`count = ${live?.length ?? 0}`);
  for (const m of live ?? []) {
    console.log(
      [m.asset, `interval=${m.intervalSec}s`, `status=${m.status}`,
       `market=${m.marketAddress}`, `pool=${m.poolAddress}`, `nonce=${m.nonce}`]
        .join("  ")
    );
  }

  const first = live?.[0];
  if (!first) { console.log("\nNo live markets — cannot pin book params."); return; }

  line(`ON-CHAIN TRUTH — ${first.asset} ${first.intervalSec}s`);
  console.log("market row fields:", Object.keys(first).join(", "));
  const onchain = await client.getMarketOnchain(first.id ?? first.marketId);
  console.log(JSON.stringify(onchain, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2));

  line("BOOK PARAMS  ⚑ pin these into .env");
  const bp = await client.getBinaryBookParams(first.poolAddress);
  console.log(JSON.stringify(bp, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2));

  line("ORDER BOOK — decimals probe");
  for (const d of [6, 18]) {
    try {
      const ob = await client.getBinaryOrderBook(first.poolAddress, { decimals: d });
      const top = (side: any[]) => (side?.[0] ? `${side[0].price} × ${side[0].quantity}` : "—");
      console.log(`decimals=${d}  yesAsk ${top(ob.yesAsks)}   noAsk ${top(ob.noAsks)}   ` +
                  `yesBid ${top(ob.yesBids)}   noBid ${top(ob.noBids)}`);
    } catch (e: any) { console.log(`decimals=${d}  ERROR ${e?.shortMessage ?? e?.message}`); }
  }
  console.log("→ the correct value is the one where NO side is not negative");

  line("WHO HAS CREATED VENUES / CREATORS / SERIES?  (is creation open?)");
  for (const [label, call] of [
    ["operators",      () => client.listOperators({ limit: 30 })],
    ["venues",         () => client.listVenues({ limit: 30 })],
    ["marketCreators", () => client.listMarketCreators({ limit: 30 })],
    ["series",         () => client.listSeries({ limit: 30 })],
  ] as const) {
    try {
      const rows = await call();
      console.log(`\n${label}: ${rows?.length ?? 0}`);
      for (const r of (rows ?? []).slice(0, 12)) {
        console.log("   ", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)).slice(0, 240));
      }
    } catch (e: any) { console.log(`${label}: ERROR ${e?.shortMessage ?? e?.message}`); }
  }

  try {
    line("COST TO CREATE A MARKET");
    console.log("quoteCreateMarketValue:", await client.quoteCreateMarketValue());
  } catch (e: any) { console.log("quoteCreateMarketValue ERROR:", e?.shortMessage ?? e?.message); }

  if (!pk) { line("SKIPPED (no PRIVATE_KEY): faucet + write preflights"); return; }

  line("PREFLIGHTS — can a random dev create a venue + series?");
  const pf: any = await import("@somnia-chain/markets-sdk");
  const { preflightOperator, preflightVenue, preflightMarketCreator, preflightChain } = pf;
  const addr = (exchange as any).trader?.address ?? (exchange as any).account?.address;
  console.log("signer =", addr);
  for (const [name, fn] of [
    ["chain", preflightChain], ["operator", preflightOperator],
    ["venue", preflightVenue], ["marketCreator", preflightMarketCreator],
  ] as const) {
    try {
      const r = await (fn as any)({ client: (exchange as any).client, owner: addr, account: addr });
      console.log(`${name}:`, JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)));
    } catch (e: any) { console.log(`${name}: ERROR ${e?.shortMessage ?? e?.message}`); }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("\nFATAL:", e); process.exit(1); });

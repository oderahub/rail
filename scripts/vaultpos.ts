import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";

const VAULT = "0xc5e95a3407C568517e131dA0d18f37873fa3Fcfa" as const;
const ex = new SomniaMarkets({
  indexerUrl: process.env.INDEXER_URL!, chain: somniaShannon,
  wsRpcUrl: process.env.WS_RPC_URL!, addresses: SOMNIA_TESTNET_ADDRESSES,
} as any);
const c: any = (ex as any).client;
const pub = createPublicClient({ chain: somniaShannon as any, transport: http(process.env.RPC_URL!) });

const m = (await c.listLiveBinaryMarkets({ limit: 50 }))
  .filter((x: any) => Number(x.operatorId) === 2)
  .sort((a: any, b: any) => Number(b.expiry) - Number(a.expiry))[0];

console.log(`market: ${m.asset} ${m.intervalSec}s`);
console.log(`yesTokenId: ${m.yesTokenId}`);

const bal = await pub.readContract({
  address: SOMNIA_TESTNET_ADDRESSES.outcomeToken ?? "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
  abi: parseAbi(["function balanceOf(address,uint256) view returns (uint256)"]),
  functionName: "balanceOf",
  args: [VAULT, BigInt(m.yesTokenId)],
}) as bigint;
console.log(`\nvault YES balance: ${formatUnits(bal, 6)} contracts`);

console.log("\n— claimable for the vault —");
const claim = await c.getClaimable(VAULT);
console.log(claim.length ? claim : "(none yet — market has not settled)");

console.log("\n— open orders on-chain for the vault —");
const open = await c.getOwnOpenOrdersOnchain?.({ pool: m.poolAddress, owner: VAULT })
  .catch(() => null);
console.log(open ?? "(n/a)");
process.exit(0);

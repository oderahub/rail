/**
 * Evidence for the feedback report: is the delegated order path on BinaryPool
 * reachable at all? `placeBinaryOrderFor` exists in the ABI and is gated by
 * OnlyApprovedContracts (0x3fb0ba2e) — but the registry that can satisfy that
 * gate (OperatorPermissionsRegistry) covers SpotPool only.
 */
import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { cfg } from "../packages/core/src/config.js";
import { liveWindows } from "../packages/core/src/markets.js";

const pub = createPublicClient({ chain: somniaShannon as any, transport: http(cfg.rpcUrl) });
const bot = privateKeyToAccount(cfg.operatorKey);
const owner = cfg.ownerAddress!;

const abi = parseAbi([
  "function placeBinaryOrderFor(address owner, uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool, uint128)",
]);

const w = (await liveWindows())[0];
const price = 500_000n; // 0.500 — tick-aligned and inside (0,1); auth is checked regardless
console.log(`pool   ${w.pool}  (${w.asset} ${w.intervalSec}s)`);
console.log(`caller ${bot.address}  attempting to place FOR  ${owner}\n`);

try {
  await pub.simulateContract({
    account: bot, address: w.pool, abi, functionName: "placeBinaryOrderFor",
    args: [owner, 0, price, 1_000_000n, BigInt(Math.floor(Date.now() / 1000) + 120) * 1_000_000_000n,
           2, 0, "0x0000000000000000000000000000000000000000", 0n, 0n],
  });
  console.log("❗ SUCCEEDED — delegated placement IS reachable on binary pools");
} catch (e: any) {
  const walk = (err: any): string | undefined => {
    for (let x = err, i = 0; x && i < 8; x = x.cause, i++) {
      if (x?.data?.errorName) return x.data.errorName;
      if (typeof x?.data === "string" && x.data.startsWith("0x")) return x.data.slice(0, 10);
    }
    return undefined;
  };
  const name = walk(e);
  console.log(`reverted with: ${name ?? "(undecoded)"}`);
  if (name === "OnlyApprovedContracts" || name === "0x3fb0ba2e") {
    console.log(`
✅ CONFIRMED. placeBinaryOrderFor is gated by OnlyApprovedContracts (0x3fb0ba2e),
   and the only registry that can grant that approval — OperatorPermissionsRegistry
   — covers SpotPool exclusively. The delegated path exists in the ABI but cannot
   be reached on a BinaryPool by anyone. Making a contract the order owner is not
   a preference; it is the only option.`);
  } else {
    console.log(`   (${e?.shortMessage ?? e?.message})`.slice(0, 300));
  }
}
process.exit(0);

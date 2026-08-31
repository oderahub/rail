import { createPublicClient, http, parseAbi } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { cfg, existingVault } from "../packages/core/src/index.js";

const pub = createPublicClient({ chain: somniaShannon as any, transport: http(cfg.rpcUrl) });
const abi = parseAbi([
  "function isOperator(address owner, address spender) view returns (bool)",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
]);
const vault = (await existingVault(cfg.ownerAddress!))!;
const OWNER_EOA = cfg.ownerAddress!;

for (const [label, who] of [["vault", vault], ["owner EOA", OWNER_EOA]] as const) {
  const isOp = await pub.readContract({
    address: cfg.outcomeToken, abi, functionName: "isOperator", args: [who as `0x${string}`, cfg.binaryModule],
  });
  console.log(`${label.padEnd(10)} ${who}`);
  console.log(`   binaryModule is ERC-6909 operator for it: ${isOp}`);
}
console.log(`\noutcomeToken ${cfg.outcomeToken}`);
console.log(`binaryModule ${cfg.binaryModule}`);
console.log(`\n→ if the EOA is TRUE and the vault is FALSE, that is the whole bug:`);
console.log(`  the SDK grants this on first redeem; our vault never did.`);
process.exit(0);

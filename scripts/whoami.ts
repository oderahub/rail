import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";

const a = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const pub = createPublicClient({ transport: http(process.env.RPC_URL!) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const col = process.env.COLLATERAL_ADDRESS as `0x${string}`;
const OLD = "0x0bA50b9001b2ECcd3869CC73c07031dca1e11412" as const;

const rows = [["new key", a.address], ["old (funded)", OLD]] as const;
for (const [label, addr] of rows) {
  const [stt, usd] = await Promise.all([
    pub.getBalance({ address: addr as `0x${string}` }),
    pub.readContract({ address: col, abi: erc20, functionName: "balanceOf", args: [addr as `0x${string}`] }),
  ]);
  console.log(`${label.padEnd(13)} ${addr}  STT ${Number(formatUnits(stt, 18)).toFixed(3).padStart(9)}  tUSDC ${Number(formatUnits(usd as bigint, 6)).toFixed(2).padStart(9)}`);
}
process.exit(0);

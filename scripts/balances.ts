import "dotenv/config";
import { createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpc = process.env.RPC_URL!;
const acct = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const col = process.env.COLLATERAL_ADDRESS as `0x${string}`;
const pc = createPublicClient({ transport: http(rpc) });

const erc20 = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "decimals", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const [stt, dec, bal] = await Promise.all([
  pc.getBalance({ address: acct.address }),
  pc.readContract({ address: col, abi: erc20, functionName: "decimals" }),
  pc.readContract({ address: col, abi: erc20, functionName: "balanceOf", args: [acct.address] }),
]);

console.log(`address : ${acct.address}`);
console.log(`STT gas : ${formatUnits(stt, 18)}`);
console.log(`tUSDC   : ${formatUnits(bal as bigint, dec as number)}   (decimals=${dec})`);
console.log(bal === 0n
  ? "\n⚠️  no collateral — orders will revert with ERC20InsufficientBalance.\n   Fix: set FAUCET_ENABLED=true, or call trader.faucet()."
  : "\n✅ funded for orders.");
process.exit(0);

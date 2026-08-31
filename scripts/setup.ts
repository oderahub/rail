/**
 * Provision a clean operator/owner split.
 *   operator = PRIVATE_KEY  — the bot's hot key; trades within policy, nothing else
 *   owner    = OWNER_ADDRESS — the user; we never hold their key
 * The bot sponsors the deploy and the user still owns the result.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { cfg } from "../packages/core/src/config.js";

const art = (n: string) => JSON.parse(readFileSync(`contracts/out/${n}.sol/${n}.json`, "utf8"));
const bot = privateKeyToAccount(cfg.operatorKey);
const transport = http(cfg.rpcUrl);
const pub = createPublicClient({ chain: somniaShannon as any, transport });
const wal = createWalletClient({ account: bot, chain: somniaShannon as any, transport });
const owner = cfg.ownerAddress!;
const step = (s: string) => console.log(`\n▸ ${s}`);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function faucet(uint256)",
]);
const POLICY = [5_000_000n, 50_000_000n, 0, 30] as const; // 5 / 50 / no cooldown / 30s headroom

console.log(`operator (bot)  ${bot.address}`);
console.log(`owner    (user) ${owner}`);

step("faucet tUSDC to the bot so it can fund the vault");
let bal = (await pub.readContract({ address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [bot.address] })) as bigint;
if (bal < 200_000_000n) {
  const h = await wal.writeContract({ address: cfg.collateral, abi: erc20, functionName: "faucet", args: [10_000_000_000n] });
  await pub.waitForTransactionReceipt({ hash: h });
  bal = (await pub.readContract({ address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [bot.address] })) as bigint;
}
console.log(`  bot tUSDC: ${formatUnits(bal, 6)}`);

step("deploy RailFactory with the bot as operator");
const fa = art("RailFactory");
const dh = await wal.deployContract({
  abi: fa.abi, bytecode: fa.bytecode.object as `0x${string}`,
  args: [bot.address, cfg.collateral, cfg.binaryModule, cfg.outcomeToken],
  chain: somniaShannon as any, account: bot,
});
const factory = (await pub.waitForTransactionReceipt({ hash: dh })).contractAddress!;
console.log(`  factory: ${factory}`);

step("bot sponsors the deploy; the USER owns the vault");
const predicted = await pub.readContract({ address: factory, abi: fa.abi, functionName: "vaultOf", args: [owner, POLICY] }) as `0x${string}`;
const vh = await wal.writeContract({ address: factory, abi: fa.abi, functionName: "deployFor", args: [owner, POLICY], chain: somniaShannon as any, account: bot });
await pub.waitForTransactionReceipt({ hash: vh });
const vault = await pub.readContract({ address: factory, abi: fa.abi, functionName: "vaultOfOwner", args: [owner] }) as `0x${string}`;
console.log(`  vault: ${vault} ${vault.toLowerCase() === predicted.toLowerCase() ? "✅ matches prediction" : "❌ MISMATCH"}`);

const va = art("RailVault");
const [vOwner, vOperator] = await Promise.all([
  pub.readContract({ address: vault, abi: va.abi, functionName: "owner" }),
  pub.readContract({ address: vault, abi: va.abi, functionName: "operator" }),
]);
console.log(`  owner    = ${vOwner}  ${String(vOwner).toLowerCase() === owner.toLowerCase() ? "✅ the user, not the sponsor" : "❌"}`);
console.log(`  operator = ${vOperator} ${String(vOperator).toLowerCase() === bot.address.toLowerCase() ? "✅ the bot" : "❌"}`);

step("fund the vault");
const fh = await wal.writeContract({ address: cfg.collateral, abi: erc20, functionName: "transfer", args: [vault, 100_000_000n], chain: somniaShannon as any, account: bot });
await pub.waitForTransactionReceipt({ hash: fh });
const vb = (await pub.readContract({ address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [vault] })) as bigint;
console.log(`  vault tUSDC: ${formatUnits(vb, 6)}`);

step("can the module burn this vault's outcome tokens? (the redeem gate)");
const canRedeem = await pub.readContract({ address: vault, abi: va.abi, functionName: "moduleCanRedeem" });
console.log(`  moduleCanRedeem: ${canRedeem} ${canRedeem ? "✅" : "❌ redeem will revert"}`);

console.log(`\n→ put this in .env:\nFACTORY_ADDRESS=${factory}`);
process.exit(0);

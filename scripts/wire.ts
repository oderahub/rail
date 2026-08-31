/**
 * Day 2 — put the vault in front of a real BinaryPool.
 * Deploys the factory, mints a vault, funds it, and places one order the
 * VAULT owns. The thing we are hunting for is IncorrectSender.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, ORDER_KIND, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const art = (n: string) => JSON.parse(readFileSync(`contracts/out/${n}.sol/${n}.json`, "utf8"));
const acct = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const transport = http(process.env.RPC_URL!);
const pub = createPublicClient({ chain: somniaShannon as any, transport });
const wal = createWalletClient({ account: acct, chain: somniaShannon as any, transport });

const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.collateral as `0x${string}`;
const MODULE = SOMNIA_TESTNET_ADDRESSES.binaryModule as `0x${string}`;
const erc20 = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const step = (s: string) => console.log(`\n▸ ${s}`);

const POLICY = {
  maxNotionalPerOrder: 5_000_000n, // 5 tUSDC
  dailyCap: 50_000_000n,           // 50 tUSDC
  cooldownSecs: 0,
  minExpiryHeadroom: 30,
} as const;
const policyTuple = [POLICY.maxNotionalPerOrder, POLICY.dailyCap, POLICY.cooldownSecs, POLICY.minExpiryHeadroom];

async function main() {
  const fa = art("RailFactory");
  let factory = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
  let hash: `0x${string}`;
  if (factory) {
    step(`reuse RailFactory ${factory}`);
  } else {
    step("deploy RailFactory");
    hash = await wal.deployContract({
      abi: fa.abi, bytecode: fa.bytecode.object as `0x${string}`,
      args: [acct.address, COLLATERAL, MODULE],
    });
    factory = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    console.log("  factory:", factory);
  }

  step("predict + deploy vault");
  const predicted = await pub.readContract({
    address: factory, abi: fa.abi, functionName: "vaultOf", args: [acct.address, policyTuple],
  }) as `0x${string}`;
  console.log("  predicted:", predicted);
  const already = await pub.readContract({
    address: factory, abi: fa.abi, functionName: "vaultOfOwner", args: [acct.address],
  }) as `0x${string}`;
  if (already === "0x0000000000000000000000000000000000000000") {
    hash = await wal.writeContract({
      address: factory, abi: fa.abi, functionName: "deployFor", args: [acct.address, policyTuple],
    });
    await pub.waitForTransactionReceipt({ hash });
  } else {
    console.log("  (vault already exists — reusing)");
  }
  const vault = await pub.readContract({
    address: factory, abi: fa.abi, functionName: "vaultOfOwner", args: [acct.address],
  }) as `0x${string}`;
  console.log("  deployed :", vault, predicted.toLowerCase() === vault.toLowerCase() ? "✅ matches" : "❌ MISMATCH");

  step("fund the vault (it must hold and spend its OWN collateral)");
  const cur = await pub.readContract({ address: COLLATERAL, abi: erc20, functionName: "balanceOf", args: [vault] }) as bigint;
  if (cur < 10_000_000n) {
    hash = await wal.writeContract({ address: COLLATERAL, abi: erc20, functionName: "transfer", args: [vault, 100_000_000n] });
    await pub.waitForTransactionReceipt({ hash });
  }
  const vbal = await pub.readContract({ address: COLLATERAL, abi: erc20, functionName: "balanceOf", args: [vault] });
  console.log("  vault tUSDC:", formatUnits(vbal as bigint, 6));

  step("pick a live market with room to spare");
  const ex = new SomniaMarkets({
    indexerUrl: process.env.INDEXER_URL!, chain: somniaShannon,
    wsRpcUrl: process.env.WS_RPC_URL!, addresses: SOMNIA_TESTNET_ADDRESSES,
  } as any);
  const c: any = (ex as any).client;
  const live = (await c.listLiveBinaryMarkets({ limit: 50 }))
    .filter((m: any) => Number(m.operatorId) === 2)
    .sort((a: any, b: any) => Number(b.expiry) - Number(a.expiry));
  const m = live[0];
  const secsLeft = Number(m.expiry) - Math.floor(Date.now() / 1000);
  console.log(`  ${m.asset} ${m.intervalSec}s  pool=${m.poolAddress}  ${secsLeft}s to expiry`);

  const onchain = await c.getMarketOnchain(m.id);
  console.log("  status:", onchain.status, onchain.status === 1 ? "(Trading)" : "(NOT TRADING — abort)");
  if (onchain.status !== 1) return;

  const book = await c.getBinaryOrderBook(m.poolAddress, { decimals: 6 });
  const ask = book.yesAsks?.[0];
  console.log("  best yes ask:", ask ? `${ask.price} × ${ask.quantity}` : "(empty book)");

  step("place ONE order — owned by the vault");
  // cross a touch through the ask; snap to the 1000-raw tick/lot grid
  const rawAsk = ask ? BigInt(ask.price) : 500_000n; // already raw 6-dec (526000 == 0.526)
  const price = ((rawAsk + 20_000n) / 1000n) * 1000n; // +2c, tick-aligned
  const quantity = 1_000_000n;                        // 1 contract, lot-aligned
  const notional = (price * quantity) / 1_000_000n;
  const expireNs = BigInt(Math.floor(Date.now() / 1000) + 120) * 1_000_000_000n;
  console.log(`  price=${price} qty=${quantity} notional=${formatUnits(notional, 6)} tUSDC (cap ${formatUnits(POLICY.maxNotionalPerOrder, 6)})`);

  const va = art("RailVault");
  const order = {
    pool: m.poolAddress as `0x${string}`,
    kind: ORDER_KIND.BUY_YES,
    price, quantity,
    expireTimestampNs: expireNs,
    orderType: ORDER_TYPE.MARKET,
    selfMatchingOption: 0,
    builder: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    builderFeeBpsTimes1k: 0n,
    userData: 0n,
  };

  try {
    const sim = await pub.simulateContract({
      account: acct, address: vault, abi: va.abi, functionName: "placeOrder", args: [order],
    });
    console.log("  simulate: OK →", sim.result);
    const h = await wal.writeContract(sim.request as any);
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ✅ FILLED  status=${rc.status}  gas=${rc.gasUsed}`);
    console.log(`  tx: https://shannon-explorer.somnia.network/tx/${h}`);
  } catch (e: any) {
    console.log("  ❌ reverted:", e?.shortMessage ?? e?.message);
    const d = e?.cause?.data ?? e?.data;
    if (d) console.log("  raw revert data:", JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)).slice(0, 400));
  }

  const after = await pub.readContract({ address: COLLATERAL, abi: erc20, functionName: "balanceOf", args: [vault] });
  console.log(`\n  vault tUSDC after: ${formatUnits(after as bigint, 6)} (spent ${formatUnits((vbal as bigint) - (after as bigint), 6)})`);
  console.log(`  vault: https://shannon-explorer.somnia.network/address/${vault}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\nFATAL:", e?.shortMessage ?? e); process.exit(1); });

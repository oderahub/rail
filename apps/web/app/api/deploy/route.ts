import { NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient, http, isAddress, defineChain, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";

const chain = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://dream-rpc.somnia.network"] } },
  testnet: true,
});

// only what this route needs — importing the core would drag artifact reads
// through the bundler for no benefit
const factoryAbi = parseAbi([
  "function vaultOf(address owner, (uint128,uint128,uint32,uint32) policy) view returns (address)",
  "function vaultOfOwner(address) view returns (address)",
  "function deployFor(address owner, (uint128,uint128,uint32,uint32) policy) returns (address)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

const clamp = (v: unknown, lo: bigint, hi: bigint, dflt: bigint): bigint => {
  const n = typeof v === "number" || typeof v === "string" ? BigInt(Math.round(Number(v) * 1e6)) : dflt;
  return n < lo ? lo : n > hi ? hi : n;
};

export async function POST(req: Request) {
  try {
    const factory = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
    const key = process.env.PRIVATE_KEY as `0x${string}` | undefined;
    if (!factory || !key) {
      return NextResponse.json({ error: "server not configured" }, { status: 500 });
    }

    const body = await req.json();
    const owner = String(body.owner ?? "");
    if (!isAddress(owner)) return NextResponse.json({ error: "bad address" }, { status: 400 });

    // bounded server-side: a client cannot ask for a limitless vault
    const policy = [
      clamp(body.maxPerOrder, 100_000n, 100_000_000n, 5_000_000n),
      clamp(body.dailyCap, 100_000n, 1_000_000_000n, 50_000_000n),
      0,
      30,
    ] as const;

    const operator = privateKeyToAccount(key);
    const pub = createPublicClient({ chain, transport: http() });
    const wallet = createWalletClient({ account: operator, chain, transport: http() });

    const existing = (await pub.readContract({
      address: factory, abi: factoryAbi, functionName: "vaultOfOwner", args: [owner],
    })) as string;

    if (existing !== ZERO) {
      return NextResponse.json({ vault: existing, alreadyExisted: true });
    }

    const predicted = (await pub.readContract({
      address: factory, abi: factoryAbi, functionName: "vaultOf", args: [owner, policy],
    })) as string;

    // the operator pays the gas and never becomes the owner — proven by
    // test_anyoneCanDeployForSomeoneElse, so a new user signs nothing here
    const sim = await pub.simulateContract({
      account: operator, address: factory, abi: factoryAbi, functionName: "deployFor", args: [owner, policy],
    });
    const hash = await wallet.writeContract(sim.request as any);
    await pub.waitForTransactionReceipt({ hash });

    const vault = (await pub.readContract({
      address: factory, abi: factoryAbi, functionName: "vaultOfOwner", args: [owner],
    })) as string;

    return NextResponse.json({ vault, predicted, txHash: hash, alreadyExisted: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? "deploy failed" }, { status: 500 });
  }
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient, createWalletClient, http, parseAbi, decodeErrorResult, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { protocolErrorsAbi } from "./protocolErrors.js";
import { cfg, fmt } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * ABIs are committed under packages/core/abi, NOT read from contracts/out.
 * A deploy host has no Foundry, and contracts/out is gitignored — reading it
 * at import time made the bot unbootable anywhere but this laptop.
 * Regenerate after any contract change: `pnpm abi`.
 */
const artifact = (n: string) =>
  JSON.parse(readFileSync(resolve(here, `../abi/${n}.json`), "utf8"));

export const vaultAbi = artifact("RailVault");
export const factoryAbi = artifact("RailFactory");

const transport = http(cfg.rpcUrl);
export const pub = createPublicClient({ chain: somniaShannon as any, transport });
export const operator = privateKeyToAccount(cfg.operatorKey);
export const wallet = createWalletClient({ account: operator, chain: somniaShannon as any, transport });

/**
 * One hot key serves every user. Two people tapping in the same second would
 * otherwise both read the same pending nonce and the second transaction would
 * be dropped by the node — invisibly, as a "failed order" the user cannot
 * explain. Broadcasts are therefore serialised behind a promise chain with a
 * locally tracked nonce.
 *
 * Only the broadcast is inside the lock: receipts are awaited by the caller
 * afterwards, so confirmations still overlap and throughput stays fine.
 */
let sendQueue: Promise<unknown> = Promise.resolve();
let nextNonce: number | null = null;

export function write(args: any): Promise<`0x${string}`> {
  const run = sendQueue.then(async () => {
    if (nextNonce === null) {
      nextNonce = await pub.getTransactionCount({ address: operator.address, blockTag: "pending" });
    }
    try {
      const hash = await wallet.writeContract({ ...args, nonce: nextNonce });
      nextNonce++;
      return hash;
    } catch (e) {
      nextNonce = null; // lost track — resync against the chain next time
      throw e;
    }
  });
  sendQueue = run.then(() => {}, () => {});
  return run as Promise<`0x${string}`>;
}

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
const erc6909 = parseAbi(["function balanceOf(address,uint256) view returns (uint256)"]);

export interface Policy {
  maxNotionalPerOrder: bigint;
  dailyCap: bigint;
  cooldownSecs: number;
  minExpiryHeadroom: number;
}
export const policyTuple = (p: Policy) =>
  [p.maxNotionalPerOrder, p.dailyCap, p.cooldownSecs, p.minExpiryHeadroom] as const;

export const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** The address a user's vault has — or will have. Lets the UI show it pre-deploy. */
export async function vaultAddressFor(owner: Address, policy: Policy): Promise<Address> {
  if (!cfg.factory) throw new Error("FACTORY_ADDRESS not set");
  return pub.readContract({
    address: cfg.factory, abi: factoryAbi, functionName: "vaultOf", args: [owner, policyTuple(policy)],
  }) as Promise<Address>;
}

export async function existingVault(owner: Address): Promise<Address | null> {
  if (!cfg.factory) throw new Error("FACTORY_ADDRESS not set");
  const v = (await pub.readContract({
    address: cfg.factory, abi: factoryAbi, functionName: "vaultOfOwner", args: [owner],
  })) as Address;
  return v === ZERO ? null : v;
}

/** Deploy a vault OWNED BY `owner`. The caller pays gas and never becomes owner. */
export async function deployVault(owner: Address, policy: Policy): Promise<Address> {
  if (!cfg.factory) throw new Error("FACTORY_ADDRESS not set");
  const existing = await existingVault(owner);
  if (existing) return existing;
  const sim = await pub.simulateContract({
    account: operator, address: cfg.factory, abi: factoryAbi,
    functionName: "deployFor", args: [owner, policyTuple(policy)],
  });
  const hash = await write(sim.request as any);
  await pub.waitForTransactionReceipt({ hash });
  return (await existingVault(owner))!;
}

/** Testnet convenience: mint tUSDC and push it into a vault. */
export async function faucetInto(vault: Address, amount = 100_000_000n): Promise<`0x${string}`> {
  const faucetAbi = parseAbi(["function faucet(uint256)"]);
  const have = (await pub.readContract({
    address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [operator.address],
  })) as bigint;
  if (have < amount) {
    const h = await write({
      address: cfg.collateral, abi: faucetAbi, functionName: "faucet",
      args: [10_000_000_000n], chain: null, account: operator,
    } as any);
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const hash = await write({
    address: cfg.collateral, abi: erc20, functionName: "transfer",
    args: [vault, amount], chain: null, account: operator,
  } as any);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export interface VaultState {
  address: Address;
  owner: Address;
  collateral: bigint;
  spentToday: bigint;
  remainingToday: bigint;
  halted: boolean;
  policy: Policy;
}

export async function vaultState(vault: Address): Promise<VaultState> {
  const call = (fn: string, args: any[] = []) =>
    pub.readContract({ address: vault, abi: vaultAbi, functionName: fn, args });
  const [owner, spent, remaining, halted, policy, bal] = await Promise.all([
    call("owner"), call("spentInWindow"), call("remainingToday"), call("halted"), call("policy"),
    pub.readContract({ address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [vault] }),
  ]);
  const p = policy as any[];
  return {
    address: vault,
    owner: owner as Address,
    collateral: bal as bigint,
    spentToday: spent as bigint,
    remainingToday: remaining as bigint,
    halted: halted as boolean,
    policy: {
      maxNotionalPerOrder: p[0], dailyCap: p[1],
      cooldownSecs: Number(p[2]), minExpiryHeadroom: Number(p[3]),
    },
  };
}

export const outcomeBalance = (vault: Address, tokenId: string) =>
  pub.readContract({
    address: cfg.outcomeToken, abi: erc6909, functionName: "balanceOf", args: [vault, BigInt(tokenId)],
  }) as Promise<bigint>;

export interface OrderIntent {
  pool: Address;
  kind: number;
  price: bigint;
  quantity: bigint;
  expireTimestampNs: bigint;
  orderType: number;
}

export interface PlaceResult {
  ok: boolean;
  txHash?: `0x${string}`;
  orderId?: bigint;
  spent?: bigint;
  /** Set when a POLICY rule stopped it — the thing worth showing on screen. */
  refusedBy?: string;
  reason?: string;
  /** The two numbers behind a refusal, so a client can lay them out itself
   *  instead of parsing them back out of a sentence. */
  detail?: { label: string; asked: bigint; limit: bigint };
}

/**
 * Turn a revert into something a person can read. A policy refusal is a
 * FEATURE — it is the vault doing its job — so it is reported distinctly from
 * a genuine failure.
 */
/**
 * Turn a revert into something a person can read. A policy refusal is a
 * FEATURE — the vault doing its job — so it is reported distinctly from a
 * genuine failure.
 *
 * viem decodes custom errors itself and buries the result in the cause chain,
 * so walk the chain first and only fall back to decoding raw hex.
 */
function findRevert(err: any): { name?: string; args: any[]; selector?: string } {
  for (let e = err, i = 0; e && i < 8; e = e.cause, i++) {
    const d = e?.data;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      return { name: d.errorName, args: (d.args ?? []) as any[] };
    }
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
      // ours first, then the protocol's own catalogue
      for (const abi of [vaultAbi, protocolErrorsAbi as any]) {
        try {
          const r = decodeErrorResult({ abi, data: d as `0x${string}` });
          return { name: r.errorName, args: (r.args ?? []) as any[], selector: d.slice(0, 10) };
        } catch { /* try the next abi */ }
      }
      return { args: [], selector: d.slice(0, 10) };
    }
  }
  return { args: [] };
}

/**
 * Selectors identified by experiment rather than by name. The docs' errors page
 * lists selectors that do not match the computed ones for those signatures, and
 * these appear in neither the SDK's 422-error catalogue nor openchain — so they
 * are recorded here against reproducible evidence instead.
 */
const EMPIRICAL_SELECTORS: Record<string, string> = {
  // scripts/expiry.ts: 242s into a 262s window fills; 262s and 322s both revert
  "0xd3dea628": "That order would outlive the market it trades — its expiry must fall inside the window.",
  // scripts/delegation.ts: placeBinaryOrderFor from a non-owner
  "0x3fb0ba2e": "Delegated placement is not available on binary pools.",
};

/** Protocol errors, in the words a user needs rather than the contract's. */
function explainProtocol(name: string, a: any[]): string | undefined {
  switch (name) {
    case "ImmediateOrCancelNoFill": return "No one was there to take the other side — nothing filled.";
    case "FillOrKillNotFillable":   return "Not enough resting size to fill the whole order at once.";
    case "PostOnlyWouldCross":      return "The price moved and that quote would have taken instead of resting — requote.";
    case "OrderAlreadyExpired":     return "That order's expiry was already in the past.";
    case "SelfMatchCancelTaker":    return "That would have matched your own resting order.";
    case "InvalidPrice":            return `Price ${fmt(a[0])} is not a multiple of the ${a[1]} tick.`;
    case "InvalidQuantity":         return `Quantity ${a[0]} is not a multiple of the ${a[1]} lot.`;
    case "QuantityBelowMinimum":    return `Quantity ${a[0]} is below the pool minimum of ${a[1]}.`;
    case "PriceTooLarge":           return "Price is outside the encodable range.";
    case "InvalidAmount":           return "Amount is zero or otherwise invalid.";
    case "ZeroQuoteFillsAllowed":   return "That order would produce a zero-value fill.";
    case "InsufficientBalance":     return `Vault holds ${fmt(a[0])} but the order needs ${fmt(a[1])}.`;
    case "InsufficientGasForPayout":return "Payout gas headroom not met — raise the gas limit and re-simulate at the same limit.";
    case "IncorrectSender":         return `Only the order's owner can do that (caller ${a[0]}, expected ${a[1]}).`;
    case "IncorrectOrder":
    case "OrderIdMismatch":         return "That order is no longer live — it filled, expired, or was cancelled.";
    case "ExpiredOrderMustBeCancelled": return "That order has expired; cancel it rather than reducing it.";
    case "OnlyApprovedContracts":   return "Delegated placement is not available on binary pools — the operator registry is spot-only.";
    case "BuilderCodesNotSupported":return "Builder codes are disabled on this pool (cap is zero).";
    case "BuilderNotApproved":      return "That builder has not been approved by the order owner.";
    case "OwnableUnauthorizedAccount": return "Admin-only entrypoint.";
  }
  return undefined;
}

export function explainRevert(err: any): { refusedBy?: string; reason: string; detail?: { label: string; asked: bigint; limit: bigint } } {
  const { name, args: a, selector: sel } = findRevert(err);
  switch (name) {
    case "OrderTooLarge":
      return {
        refusedBy: "max per order",
        reason: `That order is ${fmt(a[0])} tUSDC — your per-order limit is ${fmt(a[1])}.`,
        detail: { label: "Maximum per order", asked: a[0], limit: a[1] },
      };
    case "DailyCapExceeded":
      return {
        refusedBy: "daily cap",
        reason: `You have spent ${fmt(a[0])} today; another ${fmt(a[1])} would pass your ${fmt(a[2])} daily cap.`,
        detail: { label: "Maximum per day", asked: a[0] + a[1], limit: a[2] },
      };
    case "Cooldown":
      return { refusedBy: "cooldown", reason: `Too soon — ${a[0]}s left on your cooldown.` };
    case "ExpiryTooSoon":
      return { refusedBy: "expiry headroom", reason: "That window closes too soon to be worth entering." };
    case "Halted_":
      return { refusedBy: "halted", reason: "Trading is halted on this vault." };
    case "NotOperator":
    case "NotOwner":
      return { reason: "Not permitted." };
  }
  if (name) {
    const friendly = explainProtocol(name, a);
    if (friendly) return { reason: friendly };
    return { reason: name };
  }
  if (sel && EMPIRICAL_SELECTORS[sel]) return { reason: EMPIRICAL_SELECTORS[sel] };
  const msg: string = err?.shortMessage ?? err?.message ?? "reverted";
  return { reason: sel ? `${msg} (${sel})` : msg };
}

/**
 * Place WITHOUT simulating first, so a policy refusal is mined as a reverted
 * transaction anyone can open on the explorer. Costs gas on purpose: a demo
 * that says "trust me, it reverted" is worth less than a hash.
 */
export async function placeOrderOnChain(vault: Address, o: OrderIntent): Promise<PlaceResult> {
  const args = [{
    pool: o.pool, kind: o.kind, price: o.price, quantity: o.quantity,
    expireTimestampNs: o.expireTimestampNs, orderType: o.orderType,
    selfMatchingOption: 0, builder: ZERO, builderFeeBpsTimes1k: 0n, userData: 0n,
  }];
  let txHash: `0x${string}` | undefined;
  try {
    txHash = await write({
      address: vault, abi: vaultAbi, functionName: "placeOrder", args,
      gas: 3_000_000n, chain: null, account: operator,
    } as any);
    const rc = await pub.waitForTransactionReceipt({ hash: txHash });
    if (rc.status === "success") return { ok: true, txHash };
    // mined and reverted — ask the node why
    try {
      await pub.simulateContract({ account: operator, address: vault, abi: vaultAbi, functionName: "placeOrder", args });
      return { ok: false, txHash, reason: "reverted on-chain" };
    } catch (e: any) {
      return { ok: false, txHash, ...explainRevert(e) };
    }
  } catch (e: any) {
    return { ok: false, txHash, ...explainRevert(e) };
  }
}

export async function placeOrder(vault: Address, o: OrderIntent): Promise<PlaceResult> {
  const args = [{
    pool: o.pool, kind: o.kind, price: o.price, quantity: o.quantity,
    expireTimestampNs: o.expireTimestampNs, orderType: o.orderType,
    selfMatchingOption: 0, builder: ZERO, builderFeeBpsTimes1k: 0n, userData: 0n,
  }];
  const before = (await pub.readContract({
    address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [vault],
  })) as bigint;
  try {
    const sim = await pub.simulateContract({
      account: operator, address: vault, abi: vaultAbi, functionName: "placeOrder", args,
    });
    const txHash = await write(sim.request as any);
    await pub.waitForTransactionReceipt({ hash: txHash });
    const after = (await pub.readContract({
      address: cfg.collateral, abi: erc20, functionName: "balanceOf", args: [vault],
    })) as bigint;
    const [, orderId] = sim.result as [boolean, bigint];
    return { ok: true, txHash, orderId, spent: before > after ? before - after : 0n };
  } catch (e: any) {
    return { ok: false, ...explainRevert(e) };
  }
}

const send = async (vault: Address, fn: string, args: any[] = []) => {
  const sim = await pub.simulateContract({ account: operator, address: vault, abi: vaultAbi, functionName: fn, args });
  const hash = await write(sim.request as any);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
};

export const cancelOrder = (vault: Address, pool: Address, orderId: bigint) =>
  send(vault, "cancelOrder", [pool, orderId]);

/** Destination is hardcoded to the owner, so the bot may call this. */
export const withdrawAll = (vault: Address) => send(vault, "withdrawAll");
export const redeemInto = (vault: Address, marketId: `0x${string}`, outcomeIdx: number, amount: bigint) =>
  send(vault, "redeem", [cfg.operatorId, cfg.venueId, marketId, outcomeIdx, amount]);

import { parseAbi, type Address } from "viem";
import { cfg } from "./config.js";
import { exchange } from "./markets.js";
import { pub, write, operator, redeemInto } from "./vault.js";

const client = (): any => (exchange() as any).client;

export interface Claimable {
  marketId: `0x${string}`;
  pool: Address;
  outcomeIdx: number;
  amount: bigint;
  estPayout: bigint;
  voided: boolean;
}

/** Settled markets vanish from live views — a user who never sweeps just loses it. */
export async function claimableFor(vault: Address): Promise<Claimable[]> {
  const rows = await client().getClaimable(vault);
  return (rows ?? []).map((r: any) => ({
    marketId: r.marketId,
    pool: r.pool,
    outcomeIdx: Number(r.outcomeIdx),
    amount: BigInt(r.amount),
    estPayout: BigInt(r.estPayout ?? r.amount),
    voided: Boolean(r.voided),
  }));
}

export interface Settled {
  marketId: `0x${string}`;
  pool: Address;
  outcomeIdx: number;
  /** Contracts held. */
  amount: bigint;
  /** What redeeming them returns — 0 means this side lost. */
  payout: bigint;
  voided: boolean;
  won: boolean;
}

export interface SweepResult {
  claimed: number;
  total: bigint;
  settled: Settled[];
  stuck: { marketId: string; reason: string }[];
}

/** Redeem everything owed to one vault. Anyone may call this — it only moves value IN. */
export async function sweep(vault: Address): Promise<SweepResult> {
  const out: SweepResult = { claimed: 0, total: 0n, settled: [], stuck: [] };
  for (const c of await claimableFor(vault)) {
    const rec: Settled = {
      marketId: c.marketId, pool: c.pool, outcomeIdx: c.outcomeIdx,
      amount: c.amount, payout: c.estPayout, voided: c.voided,
      won: c.estPayout > 0n,
    };
    try {
      await redeemInto(vault, c.marketId, c.outcomeIdx, c.amount);
      out.claimed++;
      out.total += c.estPayout;
      out.settled.push(rec);
    } catch (e: any) {
      // a market finalized with a null outcome locks collateral in the MARKET,
      // not the vault — try to shake it loose before giving up
      const tried = await unstick(c.marketId).catch(() => []);
      const recovered = tried.some((t) => t.ok);
      if (recovered) {
        try {
          await redeemInto(vault, c.marketId, c.outcomeIdx, c.amount);
          out.claimed++;
          out.total += c.estPayout;
          out.settled.push(rec);
          continue;
        } catch { /* still stuck */ }
      }
      out.stuck.push({ marketId: c.marketId, reason: e?.shortMessage ?? e?.message ?? "redeem failed" });
    }
  }
  return out;
}

const moduleAbi = parseAbi([
  "function pokeOracle(uint256 oracleQuestionId)",
  "function syncSettlement(bytes32 marketId)",
  "function finalizeMarket(bytes32 marketId)",
]);

/**
 * A market can finalize with a null outcome — collateral then sits in the
 * MARKET, not the vault, and no withdrawal path reaches it. These three are
 * permissionless, so we can try to shake it loose instead of hanging.
 */
export async function unstick(marketId: `0x${string}`, oracleQuestionId?: bigint) {
  const tried: { fn: string; ok: boolean; note?: string }[] = [];
  const attempt = async (fn: "pokeOracle" | "syncSettlement" | "finalizeMarket", args: readonly [any]) => {
    try {
      const sim = await pub.simulateContract({ account: operator, address: cfg.binaryModule, abi: moduleAbi, functionName: fn, args });
      const hash = await write(sim.request as any);
      await pub.waitForTransactionReceipt({ hash });
      tried.push({ fn, ok: true });
    } catch (e: any) {
      tried.push({ fn, ok: false, note: e?.shortMessage ?? e?.message });
    }
  };
  if (oracleQuestionId !== undefined) await attempt("pokeOracle", [oracleQuestionId]);
  await attempt("syncSettlement", [marketId]);
  await attempt("finalizeMarket", [marketId]);
  return tried;
}

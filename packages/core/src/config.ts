import "dotenv/config";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in .env — see .env.example`);
  return v;
};

/**
 * A key pasted into a hosting dashboard rarely arrives clean: it comes wrapped
 * in the quotes it had in .env, or as the whole KEY=VALUE line, or without its
 * 0x. viem then fails deep inside @noble/curves with "expected hex or 32 bytes",
 * which says nothing about what to fix. Normalise what is recoverable and name
 * the problem when it isn't — never echoing the value itself.
 */
const privateKey = (): `0x${string}` => {
  let v = (process.env.PRIVATE_KEY ?? "").trim();
  if (!v) throw new Error("PRIVATE_KEY is not set. It must be a 32-byte hex key: 66 characters beginning 0x.");
  if (v.startsWith("PRIVATE_KEY=")) v = v.slice("PRIVATE_KEY=".length).trim();
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) v = `0x${v}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(
      `PRIVATE_KEY is not a 32-byte hex key: got ${v.length} characters, expected 66 beginning 0x. ` +
        "Check the host's dashboard for surrounding quotes, a pasted KEY=VALUE line, a missing 0x, or a trailing space."
    );
  }
  return v as `0x${string}`;
};

export const cfg = {
  rpcUrl: need("RPC_URL"),
  indexerUrl: need("INDEXER_URL"),
  wsRpcUrl: need("WS_RPC_URL"),
  chainId: Number(process.env.CHAIN_ID ?? 50312),

  /** Shannon hosts more than one binary venue; scoping is mandatory, not optional. */
  operatorId: Number(need("OPERATOR_ID")),
  venueId: process.env.VENUE_ID as `0x${string}` | undefined,

  collateral: SOMNIA_TESTNET_ADDRESSES.collateral as `0x${string}`,
  binaryModule: SOMNIA_TESTNET_ADDRESSES.binaryModule as `0x${string}`,
  outcomeToken: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9" as `0x${string}`,

  /** Read from the Market, never assumed. Testnet is 6; mainnet USDso is 18. */
  decimals: Number(process.env.COLLATERAL_DECIMALS ?? 6),
  tickSize: BigInt(process.env.BOOK_TICK_SIZE ?? 1000),
  lotSize: BigInt(process.env.BOOK_LOT_SIZE ?? 1000),
  minQuantity: BigInt(process.env.BOOK_MIN_QUANTITY ?? 1000),

  factory: process.env.FACTORY_ADDRESS as `0x${string}` | undefined,

  /** The bot's hot key. It may trade within policy and push funds home — nothing else. */
  operatorKey: privateKey(),

  /**
   * Whose vault we are acting on. In production this is the user's wallet and
   * we never hold its key; in testing it is a second address so owner and
   * operator stay genuinely separate. Falls back to the operator only if unset.
   */
  ownerAddress: process.env.OWNER_ADDRESS as `0x${string}` | undefined,
  explorer: "https://shannon-explorer.somnia.network",
} as const;

export const scale = 10n ** BigInt(cfg.decimals);
export const toHuman = (raw: bigint) => Number(raw) / Number(scale);
export const fmt = (raw: bigint, dp = 3) => toHuman(raw).toFixed(dp);

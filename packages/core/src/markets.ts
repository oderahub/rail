import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { cfg } from "./config.js";

export interface Window {
  id: `0x${string}`;
  marketAddress: `0x${string}`;
  pool: `0x${string}`;
  asset: string;
  intervalSec: number;
  expiry: number;
  secsLeft: number;
  yesTokenId: string;
  noTokenId: string;
}

export interface Level { price: bigint; quantity: bigint }

/**
 * One book, seen from both outcomes. The NO side is quoted directly — do not
 * reconstruct it as `1 - yes`, because the spread means the complement of the
 * YES bid is not the NO ask you can actually hit.
 */
export interface Book {
  yesBid?: Level;
  yesAsk?: Level;
  noBid?: Level;
  noAsk?: Level;
  midYes?: bigint;
}

let _ex: SomniaMarkets | null = null;
export const exchange = (): SomniaMarkets =>
  (_ex ??= new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: somniaShannon,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  } as any));

const client = (): any => (exchange() as any).client;

/** Live windows on OUR venue only. Unscoped reads mix venues and the SDK refuses to guess. */
export async function liveWindows(): Promise<Window[]> {
  const rows = await client().listLiveBinaryMarkets({ limit: 50 });
  const now = Math.floor(Date.now() / 1000);
  return rows
    .filter((m: any) =>
      cfg.venueId ? String(m.venueId).toLowerCase() === cfg.venueId.toLowerCase() : Number(m.operatorId) === cfg.operatorId
    )
    .map((m: any) => ({
      id: m.id,
      marketAddress: m.marketAddress,
      pool: m.poolAddress,
      asset: m.asset,
      intervalSec: Number(m.intervalSec),
      expiry: Number(m.expiry),
      secsLeft: Number(m.expiry) - now,
      yesTokenId: String(m.yesTokenId),
      noTokenId: String(m.noTokenId),
    }))
    .sort((a: Window, b: Window) => a.intervalSec - b.intervalSec);
}

/**
 * Pick the window a tap should land on: shortest interval with enough runway.
 * `minSecsLeft` exists because a market can lock between reading and sending —
 * the order then expires silently and the status flips mid-flight.
 */
export async function pickWindow(asset: string, minSecsLeft = 75): Promise<Window | null> {
  const ws = await liveWindows();
  return ws.find((w) => w.asset === asset && w.secsLeft >= minSecsLeft) ?? null;
}

/** The chain is the only authority on tradability — the indexer lags by seconds. */
export async function isTradable(id: string): Promise<boolean> {
  const oc = await client().getMarketOnchain(id);
  return oc?.status === 1;
}

export async function marketOnchain(id: string): Promise<any> {
  return client().getMarketOnchain(id);
}

/** Book levels come back as RAW integers at `decimals`, not floats: 526000 === 0.526. */
export async function book(pool: string): Promise<Book> {
  const b = await client().getBinaryOrderBook(pool, { decimals: cfg.decimals });
  const lvl = (l: any) => (l ? { price: BigInt(l.price), quantity: BigInt(l.quantity) } : undefined);
  const yesBid = lvl(b.yesBids?.[0]);
  const yesAsk = lvl(b.yesAsks?.[0]);
  const noBid = lvl(b.noBids?.[0]);
  const noAsk = lvl(b.noAsks?.[0]);
  return {
    yesBid, yesAsk, noBid, noAsk,
    midYes: yesBid && yesAsk ? (yesBid.price + yesAsk.price) / 2n : (yesAsk?.price ?? yesBid?.price),
  };
}

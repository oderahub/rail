import { cfg, scale } from "./config.js";

export class SubLotError extends Error {
  constructor(public wanted: bigint, public lot: bigint) {
    super(`Amount rounds to zero on the lot grid (wanted ${wanted}, lot ${lot}). An order for 0 is not an order.`);
  }
}
export class NoLiquidityError extends Error {
  constructor() { super("No resting liquidity on that side of the book."); }
}

const floorTo = (v: bigint, step: bigint) => (v / step) * step;

/** Snap to the tick grid, and keep the price strictly inside (0,1) — the pool
 *  rejects 0 and 1, and crossing a touch is the usual way to land on them. */
export function snapPrice(raw: bigint): bigint {
  const lo = cfg.tickSize;
  const hi = scale - cfg.tickSize;
  const snapped = floorTo(raw, cfg.tickSize);
  return snapped < lo ? lo : snapped > hi ? hi : snapped;
}

/**
 * Snap a quantity to the lot grid and REFUSE zero.
 * `amountToPrecision` floors sub-lot amounts to 0 and the bot then looks like it
 * traded while placing nothing — silent, and catastrophic on camera.
 */
export function snapQuantity(raw: bigint): bigint {
  const snapped = floorTo(raw, cfg.lotSize);
  if (snapped < cfg.minQuantity || snapped === 0n) throw new SubLotError(raw, cfg.lotSize);
  return snapped;
}

/** Contracts you can buy for `spend` at `price`, lot-aligned. */
export function quantityForSpend(spend: bigint, price: bigint): bigint {
  if (price <= 0n) throw new NoLiquidityError();
  return snapQuantity((spend * scale) / price);
}

export const notional = (price: bigint, quantity: bigint): bigint => (price * quantity) / scale;

/** Cross a touch by `throughTicks`. Price 0 never crosses — it is a literal limit of zero. */
export function crossingPrice(ask: bigint | undefined, throughTicks = 20n): bigint {
  if (ask === undefined || ask === 0n) throw new NoLiquidityError();
  if (typeof ask !== "bigint") throw new TypeError("crossingPrice takes a raw price, not a book level — pass level.price");
  return snapPrice(ask + cfg.tickSize * throughTicks);
}

/** Nanoseconds, in the future. 0/past revert with OrderAlreadyExpired. */
export const expiryNs = (secsFromNow: number): bigint =>
  BigInt(Math.floor(Date.now() / 1000) + secsFromNow) * 1_000_000_000n;

/**
 * The only correct expiry for an order on a window.
 *
 * An order may not outlive the market it trades — set expiry to the window's
 * own remaining time and it reverts (undocumented, selector 0xd3dea628). It
 * must also clear the vault's own minimum headroom. One rule, one place, so no
 * caller can get it wrong.
 */
export const orderExpiryFor = (w: { secsLeft: number }, maxSecs = 240): bigint =>
  expiryNs(Math.max(35, Math.min(w.secsLeft - 20, maxSecs)));

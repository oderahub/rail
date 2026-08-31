import { fmt, liveWindows, book } from "../packages/core/src/index.js";
for (const w of (await liveWindows()).slice(0, 4)) {
  const b = await book(w.pool);
  const s = (l?: {price: bigint}) => (l ? fmt(l.price) : "  —  ");
  console.log(`${w.asset} ${String(w.intervalSec).padStart(6)}s  yesBid ${s(b.yesBid)}  yesAsk ${s(b.yesAsk)}   noBid ${s(b.noBid)}  noAsk ${s(b.noAsk)}`);
}
process.exit(0);

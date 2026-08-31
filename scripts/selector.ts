import { toFunctionSelector } from "viem";
import { pathToFileURL } from "node:url";
const TARGETS = new Set(["0x3fb0ba2e", "0xd3dea628"]);
const mod: any = await import(pathToFileURL("/Users/mac/Desktop/rail/node_modules/.pnpm/@somnia-chain+markets-sdk@0.28.1_graphql@17.0.2_viem@2.56.0_typescript@5.9.3_/node_modules/@somnia-chain/markets-sdk/dist/contractErrorsAbi.js").href);
const names = new Set<string>();
for (const abi of (Object.values(mod).filter(Array.isArray) as any[][]))
  for (const e of abi) if (e?.type === "error") names.add(e.name);

// docs-page names the SDK may not carry
for (const n of ["OnlyApprovedContracts","IncorrectSender","BuilderCodesNotSupported","InvalidTakerSide",
                 "ZeroQuoteFillsAllowed","SelfMatchCancelTaker","FillOrKillNotFillable","NotOperator",
                 "NotAuthorized","Unauthorized","NotApproved","OperatorNotApproved","NotOwner",
                 "MarketNotTrading","NotTrading","TradingClosed","MarketLocked","PoolPaused","Paused"]) names.add(n);

const TYPES = ["", "address", "uint256", "uint128", "uint64", "uint8", "bytes32", "bool",
               "address,address", "uint256,uint256", "address,uint256", "uint128,uint256",
               "bytes32,uint256", "uint8,uint8", "address,bytes32"];
const hits: string[] = [];
for (const n of names) for (const t of TYPES) {
  const sig = `${n}(${t})`;
  try { const s = toFunctionSelector(`error ${sig}`).toLowerCase(); if (TARGETS.has(s)) hits.push(`${s}  =  ${sig}`); } catch {}
}
console.log(hits.length ? hits.join("\n") : "no match from known names × common param shapes");
console.log(`\n(searched ${names.size} names × ${TYPES.length} shapes)`);
process.exit(0);

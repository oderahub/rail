import { binaryPoolWriteAbi, binaryModuleWriteAbi, erc6909Abi } from "@somnia-chain/markets-sdk";
const dump = (name: string, abi: readonly any[]) => {
  console.log(`\n===== ${name} =====`);
  for (const f of abi as any[]) {
    if (f.type !== "function") continue;
    const args = (f.inputs ?? []).map((i: any) => `${i.type} ${i.name ?? ""}`.trim()).join(", ");
    const outs = (f.outputs ?? []).map((o: any) => o.type).join(", ");
    console.log(`  ${f.name}(${args})${outs ? " → (" + outs + ")" : ""}  [${f.stateMutability}]`);
  }
};
dump("BinaryPool (write)", binaryPoolWriteAbi);
dump("BinaryModule (write)", binaryModuleWriteAbi);
dump("ERC-6909", erc6909Abi);

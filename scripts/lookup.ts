const sels = ["0x3fb0ba2e", "0xd3dea628"];
for (const s of sels) {
  try {
    const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${s}&filter=true`);
    const d: any = await r.json();
    const hits = d?.result?.function?.[s] ?? [];
    console.log(`${s} → ${hits.length ? hits.map((h: any) => h.name).join(", ") : "(unknown to openchain)"}`);
  } catch (e: any) {
    console.log(`${s} → lookup failed: ${e?.message}`);
  }
}
process.exit(0);

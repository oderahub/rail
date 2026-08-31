import "dotenv/config";
const tok = process.env.TELEGRAM_BOT_TOKEN!;
const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`);
const d: any = await r.json();
if (d.ok) {
  console.log(`✅ token works`);
  console.log(`   name     : ${d.result.first_name}`);
  console.log(`   username : @${d.result.username}`);
  console.log(`   open it  : https://t.me/${d.result.username}`);
} else {
  console.log("❌", JSON.stringify(d));
}
process.exit(0);

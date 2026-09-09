# Hosting

Two pieces, two hosts, for a reason.

## The signing page → Vercel

Static and serverless. Already live. `apps/web` holds no key and calls nothing that costs money — the deep link hands off to the bot, which does the deploying.

## The bot → not Vercel

`apps/bot` needs a process that stays alive:

| what it does | why serverless breaks it |
|---|---|
| `bot.start()` long-polls Telegram | no persistent process |
| `subscribeLive` watches the chain for fills | subscription dies with the function |
| sweeper runs every 60s | Vercel Cron is once/day on Hobby |
| SQLite at `data/rail.db` | ephemeral filesystem |

Forcing it onto Vercel means losing pushed fills and automatic claiming — the two things that make the product feel alive. dreamDEX's own Bot Builder recommends Railway for the same reason.

### Railway, in about five minutes

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Then in the Railway dashboard:

1. **Variables** — paste the same keys as `.env`: `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `RPC_URL`, `INDEXER_URL`, `WS_RPC_URL`, `OPERATOR_ID`, `VENUE_ID`, `FACTORY_ADDRESS`, `COLLATERAL_DECIMALS`, `BOOK_TICK_SIZE`, `BOOK_LOT_SIZE`, `BOOK_MIN_QUANTITY`
2. **Volume** — mount one at `/data`, then set `DATA_DIR=/data` so the user↔vault mapping and notification history survive restarts

Without the volume the bot still runs, but a redeploy makes it forget who is linked and re-push old fills.

### Running it locally is fine

For the demo video, `npm run bot` on your machine is enough. Hosting only matters so a judge can try it themselves.

## If your network blocks Telegram

`api.telegram.org` is restricted on some ISPs — DNS resolves but the connection is dropped:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.telegram.org   # 000 = blocked
```

The bot cannot run locally in that case. A hosted process is unaffected, which is another reason to deploy rather than run it from a laptop.

## Note on logs

grammY includes the full API URL in network errors, and that URL contains the bot token. Any crash log — including a hosting dashboard's log view — can therefore leak it. Treat bot logs as secret, and rotate the token with BotFather's `/revoke` if one is ever shared.

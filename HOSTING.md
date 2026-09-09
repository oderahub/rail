# Hosting Rail

The bot is a long-lived process, not a serverless function. It holds a websocket
subscription for pushed fills and runs a 60s sweeper that claims settled
positions on users' behalf. A platform that sleeps idle instances (Render's free
web tier, Vercel functions) will silently stop both. Deploy it as a **worker**.

## What must be true

| requirement | why |
|---|---|
| Node **≥ 22.13** | `node:sqlite` does not exist on older runtimes |
| a **persistent volume** at `DATA_DIR` | the SQLite file maps Telegram users to vaults; losing it orphans everyone's vault and re-notifies their whole fill history |
| exactly **one** running instance | two processes long-polling one token makes Telegram 409 the newcomer |
| gas in the operator wallet | it pays for every vault deploy, order, claim and withdrawal |

Contract ABIs are committed under `packages/core/abi/`. They are **not** read
from `contracts/out/`, which is gitignored and absent on every host. After
changing a contract, run `pnpm abi` and commit the result.

## Railway (recommended)

```bash
npm i -g @railway/cli && railway login && railway init && railway up
```

Then in the dashboard:

1. **Variables** — set `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `VENUE_ID`,
   `FACTORY_ADDRESS`, plus the pinned values from `.env.example`.
2. **Volume** — mount one and set `DATA_DIR` to its path.
3. Confirm the deploy log shows `operator: 0x…`, a gas figure, and `Rail bot up.`

## Render

`render.yaml` declares the worker, a 1GB disk at `/data`, and the non-secret
config. Secrets are marked `sync: false` — set them in the dashboard, never in
the file.

## Reading the boot log

```
operator: 0x4258…1F34      the hot key; fund this address with STT
gas: 39.298 STT            below 0.5 and it starts refusing work
live: watching 8 markets, 3 vaults
sweeper: every 60s
Rail bot up.
```

Startup is deliberately fault-tolerant: if the indexer is unreachable, the live
layer logs and is skipped rather than aborting boot. A bot that answers with
stale prices beats one that will not start.

## Two hazards worth knowing

**grammY prints the bot token on network errors.** The API URL *is* the
credential (`api.telegram.org/bot<token>/METHOD`), so any logged request URL
leaks it. Don't paste raw crash output into a shared channel; rotate via
BotFather `/revoke` if you do.

**Some ISPs block `api.telegram.org` outright.** If `curl -s -o /dev/null -w
'%{http_code}' https://api.telegram.org` returns `000` while `t.me` and the
Somnia RPC both answer, the network is the problem, not the bot. Hosting sidesteps
it entirely.

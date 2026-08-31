import type { Bot } from "grammy";
import { cfg, fmt, sweep, claimableFor } from "../../../packages/core/src/index.js";
import { allUsers, isNewSettlement } from "./store.js";

const tx = (h: string) => `${cfg.explorer}/tx/${h}`;

/**
 * One sweeper for everyone.
 *
 * Settled markets vanish from live views, so winnings are genuinely easy to
 * lose — a user who never claims simply forfeits. `redeem` on the vault is
 * permissionless precisely so this can run on their behalf without holding
 * anything of theirs.
 *
 * Lifecycle transitions emit no subscribable event (`poke` is documented as "a
 * no-op since status is derived"), so this is a timer rather than a Reactivity
 * subscription — which also avoids burning 32 STT per handler against a 50/day
 * faucet.
 */
export function startSweeper(bot: Bot, everyMs = 60_000) {
  let running = false;

  const tick = async () => {
    if (running) return; // windows can settle faster than a slow sweep finishes
    running = true;
    try {
      for (const u of allUsers()) {
        let pending;
        try {
          pending = await claimableFor(u.vault);
        } catch { continue; }
        if (pending.length === 0) continue;

        const result = await sweep(u.vault);

        for (const s of result.settled) {
          if (!isNewSettlement(s.marketId, s.outcomeIdx, u.tgId)) continue;
          const side = s.outcomeIdx === 0 ? "UP" : "DOWN";
          const text = s.voided
            ? `↩️ That market was *voided* — both sides refunded at half. *${fmt(s.payout, 2)} tUSDC* back in your vault.`
            : s.won
              ? `🎉 *${side}* came in — *${fmt(s.payout, 2)} tUSDC* is in your vault.\n\n_Claimed for you. /withdraw to send it to your wallet._`
              : `📉 *${side}* didn't come in this time.`;
          await bot.api.sendMessage(u.tgId, text, {
            parse_mode: "Markdown",
            link_preview_options: { is_disabled: true },
          }).catch(() => {});
        }

        for (const st of result.stuck) {
          console.warn(`[sweeper] stuck ${st.marketId} for ${u.vault}: ${st.reason}`);
        }

        if (result.claimed > 0) {
          console.log(`[sweeper] claimed ${result.claimed} for ${u.vault}, worth ${fmt(result.total, 2)}`);
        }
      }
    } catch (e: any) {
      console.error("[sweeper]", e?.shortMessage ?? e?.message ?? e);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  console.log(`sweeper: every ${everyMs / 1000}s`);
  return () => clearInterval(timer);
}

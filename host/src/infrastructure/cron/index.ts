import cron, { type ScheduledTask } from "node-cron";
import type { CatalogIndexer } from "./catalog-sync.js";

// Registers + starts the host's scheduled jobs at boot. GUARDED: the loop never spins in
// tests/CI (NODE_ENV=test || VITEST || LIVESTREAK_CRON_DISABLED=1), so unit runs don't hit
// live chains. The catalog-sync cadence is **every 30s** (`*/30 * * * * *`): a live stream's
// pools/odds and vault open/resolve transitions move on a seconds timescale, so a sub-minute
// refresh keeps the homepage "live" without hammering both chains — the lazy path covers any
// gap between ticks, and the read cost is N parallel market-reads, fine at demo market counts.

export const CATALOG_SYNC_CRON = "*/30 * * * * *";

export interface CronHandle {
  stop(): void;
}

export const cronDisabled = (): boolean =>
  process.env.NODE_ENV === "test" ||
  process.env.VITEST !== undefined ||
  process.env.LIVESTREAK_CRON_DISABLED === "1";

export interface RegisterCronOptions {
  readonly indexer: CatalogIndexer;
  readonly schedule?: string;
  // Force-enable/disable; defaults to !cronDisabled().
  readonly enabled?: boolean;
  // Run one pass immediately at boot so the cache is warm before the first request.
  readonly runOnBoot?: boolean;
}

export const registerCronJobs = (options: RegisterCronOptions): CronHandle => {
  const enabled = options.enabled ?? !cronDisabled();
  if (!enabled) {
    return { stop: () => undefined };
  }

  if (options.runOnBoot !== false) {
    void options.indexer.syncAll().catch((error) => {
      console.warn(`[cron]: boot catalog sync failed — ${String(error)}`);
    });
  }

  const task: ScheduledTask = cron.schedule(options.schedule ?? CATALOG_SYNC_CRON, () => {
    void options.indexer.syncAll().catch((error) => {
      console.warn(`[cron]: catalog sync tick failed — ${String(error)}`);
    });
  });

  return { stop: () => task.stop() };
};

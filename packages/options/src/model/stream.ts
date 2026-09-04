// --- exports ---

import type { PointerScheme } from "@livestreak/host";

export type OptionsStreamStatus = "none" | "live" | "ended";

export interface OptionsStreamState {
  readonly status: OptionsStreamStatus;
  readonly scheme: PointerScheme;
  readonly id: string;
  readonly updatedAtMs: number;
  readonly endedAtMs: number;
}

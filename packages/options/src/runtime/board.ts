// --- exports ---

import type { OptionsPanel } from "../bridge/panel/types.js";
import type { OptionsUserOptionsSnapshot } from "../model/snapshot.js";

export interface OptionsBoard {
  readonly revision: number;
  readonly panel: OptionsPanel;
  readonly snapshot: OptionsUserOptionsSnapshot;
}

export const assembleBoard = (
  revision: number,
  snapshot: OptionsUserOptionsSnapshot,
  panel: OptionsPanel
): OptionsBoard => ({
  revision,
  panel,
  snapshot
});

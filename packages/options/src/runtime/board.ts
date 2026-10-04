// --- exports ---

import type { OptionsPanel } from "../bridge/panel/types.js";
import type { OptionsUserOptionsSnapshot } from "../model/snapshot.js";

export interface OptionsBoard {
  readonly revision: number;
  readonly panel: OptionsPanel;
  readonly snapshot: OptionsUserOptionsSnapshot;
  /** Last runtime failure. Retained values must not be presented as a successful refresh. */
  readonly dataError?: string;
}

export const assembleBoard = (
  revision: number,
  snapshot: OptionsUserOptionsSnapshot,
  panel: OptionsPanel,
  dataError?: string
): OptionsBoard => ({
  revision,
  panel,
  snapshot,
  ...(dataError === undefined ? {} : { dataError })
});

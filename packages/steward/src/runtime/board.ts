import type { StewardPanelView } from "../model/panel.js";

// --- exports ---

export interface StewardBoard {
  readonly revision: number;
  readonly panel: StewardPanelView;
}

export const assembleBoard = (revision: number, panel: StewardPanelView): StewardBoard => ({
  revision,
  panel
});

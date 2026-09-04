import type { BookmakerPanelSnapshot } from "../bridge/panel/project.js";
import { projectBookmakerPanel } from "../bridge/panel/project.js";
import type { BookmakerPanelView } from "../model/panel.js";

// --- exports ---

export const snapshotBookmakerPanel = (snapshot: BookmakerPanelSnapshot): BookmakerPanelView =>
  projectBookmakerPanel(snapshot);

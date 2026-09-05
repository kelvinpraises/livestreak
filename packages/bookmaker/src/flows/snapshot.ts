import type { BookmakerPanelSnapshot } from "../bridge/panel/project.js";
import { projectBookmakerPanel } from "../bridge/panel/project.js";
import type { BookmakerPanelView } from "../model/watch-source.js";

// --- exports ---

export const snapshotBookmakerPanel = (snapshot: BookmakerPanelSnapshot): BookmakerPanelView =>
  projectBookmakerPanel(snapshot);

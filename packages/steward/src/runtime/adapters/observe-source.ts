import type { Board, BoardCell } from "@livestreak/observe";
import type { StewardSubject } from "../../model/subject.js";
import type { ObserveFactSource } from "../sources.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import { buildStewardFact } from "./fact.js";

// --- Observe fact source (WAVE 5 BUILD) ---
//
// Consumes `@livestreak/observe`'s control `Board` (the OWNING package's read model — we do NOT
// reimplement it). The host/executor injects an `ObserveBoardReader` backed by a real observe runtime
// (e.g. `readStoredRunBoard`); this adapter projects each board cell's status into a `source:"observe"`
// fact (rogue-observer / market-hot signals the rules consume). The board read is per-subject so the
// MULTICHAIN invariant holds — the caller resolves the right run/board per chain.

export interface ObserveBoardReader {
  // Returns the observe Board for the subject (or null when there is no live run for it).
  readonly readBoard: (subject: StewardSubject) => Promise<Board | null>;
}

export const createObserveFactSource = (reader: ObserveBoardReader): ObserveFactSource => ({
  readFacts: async (subject: StewardSubject): Promise<readonly StewardFact[]> => {
    const board = await reader.readBoard(subject);
    if (board === null) {
      return [];
    }
    return Object.entries(board.cells).map(([cellId, cell]) =>
      cellToFact(subject, cellId, cell as BoardCell)
    );
  }
});

const cellToFact = (subject: StewardSubject, cellId: string, cell: BoardCell): StewardFact => {
  const [status, message, atMs] = cell.status;
  return buildStewardFact("observe", {
    subject,
    key: `observe:cell:${cellId}`,
    value: { status, message },
    ...(typeof atMs === "number" ? { observedAtMs: atMs } : {})
  });
};

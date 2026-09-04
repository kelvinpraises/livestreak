import type { BridgeCaller } from "@livestreak/options";
import { localOperatorCaller } from "./caller.js";

/** Options bridge caller — same operator id as the observe gateway caller. */
export const optionsOperatorCaller = (): BridgeCaller => {
  const base = localOperatorCaller();
  return {
    id: base.id,
    ...(base.label === undefined ? {} : { label: base.label }),
    trusted: true
  };
};

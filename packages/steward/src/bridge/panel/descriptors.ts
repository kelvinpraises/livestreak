import type {
  CapabilityScope,
  FunctionDescriptor,
  FunctionDescriptorTarget,
  JsonSchema
} from "@livestreak/schema";

import { projectStewardFunctions } from "./project.js";
import type { StewardFunctionView, StewardPanelInput, StewardStateSnapshot } from "./types.js";

// --- Canonical FunctionDescriptor projection (Objective 4, P1 — WAVE 5) ---
//
// Like options/observe/bookmaker in wave 4, the steward bridge emits its functions as the canonical
// `@livestreak/schema` `FunctionDescriptor` (real `inputSchema`, granular `scope`) so the Remote Bridge
// Console can auto-render forms. The per-action `scope` is the SAME single-source granular scope the
// bridge enforces (S2), so the UI never shows a control the relay would deny.

export const projectStewardDescriptors = (
  snapshot: StewardStateSnapshot | StewardPanelInput
): readonly FunctionDescriptor[] =>
  projectStewardFunctions(snapshot as StewardStateSnapshot).map(toDescriptor);

// Every steward bridge action is invoked with the same arg shape (see runtime `readBridgeActionArgs`):
// `subjectId` (required) + optional `subjectKind`, `reason`, `findingId`. We model exactly that.
const stewardInputSchema = (view: StewardFunctionView): JsonSchema => ({
  type: "object",
  properties: [
    {
      name: "subjectId",
      help: "Watched subject id the action targets.",
      value: { type: "string", required: true, description: "Subject id." }
    },
    {
      name: "subjectKind",
      help: "Disambiguates subjects that share an id (S5).",
      value: {
        type: "enum",
        description: "Subject kind.",
        values: ["market", "vault", "observer", "bookmaker", "steward", "evidence", "resolution"]
      }
    },
    {
      name: "reason",
      help: "Operator-supplied justification recorded with the action.",
      value: { type: "string", required: view.name !== "ignore", description: "Reason." }
    },
    {
      name: "findingId",
      help: "Optional finding this action responds to.",
      value: { type: "string", description: "Finding id." }
    }
  ]
});

const toTarget = (view: StewardFunctionView): FunctionDescriptorTarget | undefined => {
  if (view.target === undefined) {
    return undefined;
  }
  return {
    kind: view.target.kind,
    ...(view.target.vaultId === undefined ? {} : { vaultId: view.target.vaultId })
  };
};

const toDescriptor = (view: StewardFunctionView): FunctionDescriptor => {
  const target = toTarget(view);
  return {
    name: view.name,
    label: view.label,
    scope: view.scope as CapabilityScope,
    ...(target === undefined ? {} : { target }),
    disabled: view.disabled,
    ...(view.disabledReason === undefined ? {} : { disabledReason: view.disabledReason }),
    inputSchema: stewardInputSchema(view)
  };
};

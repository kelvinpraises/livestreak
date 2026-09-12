// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// Emits id, parentId, package, and visible flags derived from liveConfigurators on the board.

import type { FunctionDescriptor, JsonSchema, CapabilityScope } from "@livestreak/schema";
import { bridgeActionScope, withDescriptorIdentity } from "@livestreak/schema";

import type { Board } from "#run/control/board/model.js";
import { isDescriptorVisibleForBoard } from "#run/control/board/visibility.js";
import type { JsonSchema as ObserveJsonSchema } from "#run/control/catalog.js";
import type { ControlFunctionView, ControlsView } from "./types.js";

// --- exports ---

export const projectObserveDescriptors = (
  controls: ControlsView,
  board?: Board
): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];

  for (const cell of controls.cells) {
    for (const fn of cell.functions) {
      descriptors.push(toDescriptor(fn, cell, board));
    }
  }

  return descriptors;
};

// --- helpers ---

const toDescriptor = (
  fn: ControlFunctionView,
  cell: ControlsView["cells"][number],
  board?: Board
): FunctionDescriptor => {
  const id = descriptorId(cell.id, fn.name);
  const parentId = parentConfiguratorId(cell.id);
  const visible = board === undefined ? true : isDescriptorVisibleForBoard(id, board);

  return withDescriptorIdentity(
    {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      name: fn.name,
      label: fn.label ?? fn.name,
      scope: `${bridgeActionScope}:${fn.name}` as CapabilityScope,
      target: { kind: cell.kind },
      disabled: fn.disabled,
      visible,
      // All observe controls are callable actions (consistent with the other packages' shape); the
      // console counts visible non-group functions, so configure/close must be 'action' to count.
      nodeKind: "action",
      order: cell.order,
      ...(fn.disabledReason === undefined ? {} : { disabledReason: fn.disabledReason }),
      ...(fn.input === undefined ? {} : { inputSchema: toCanonicalSchema(fn.input) })
    },
    { package: "observe", idPrefix: cell.id.replace(/:/g, ".") }
  );
};

// The cell-qualified dispatch id for a function (e.g. "observe.capture.file.configure"). Unique across
// cells, unlike the bare fn name — the remote console sends this so the host relay routes to the right
// cell (observe has four cells exposing `configure`/`close`). Single source of truth; the edge reuses it.
export const descriptorId = (cellId: string, fnName: string): string =>
  `observe.${cellId.replace(/:/g, ".")}.${fnName}`;

const parentConfiguratorId = (cellId: string): string | undefined => {
  if (cellId === "system:config") {
    return undefined;
  }
  if (cellId.startsWith("capture:")) {
    return `observe.capture.${cellId.slice("capture:".length)}`;
  }
  if (cellId.startsWith("sink:")) {
    return `observe.sink.${cellId.slice("sink:".length)}`;
  }
  if (cellId === "market") {
    return "observe.market";
  }
  if (cellId.startsWith("system:")) {
    return `observe.${cellId.replace(":", ".")}`;
  }
  return `observe.${cellId.replace(/:/g, ".")}`;
};

// Deep-rebuild observe's DescriptorValueSchema into the canonical JsonSchema (identical structure).
const toCanonicalSchema = (schema: ObserveJsonSchema): JsonSchema => ({
  type: schema.type,
  ...(schema.description === undefined ? {} : { description: schema.description }),
  ...(schema.required === undefined ? {} : { required: schema.required }),
  ...(schema.default === undefined ? {} : { default: schema.default }),
  ...(schema.values === undefined ? {} : { values: [...schema.values] }),
  ...(schema.properties === undefined
    ? {}
    : {
        properties: schema.properties.map((property) => ({
          name: property.name,
          value: toCanonicalSchema(property.value),
          help: property.help
        }))
      }),
  ...(schema.items === undefined ? {} : { items: toCanonicalSchema(schema.items) }),
  ...(schema.variants === undefined
    ? {}
    : { variants: schema.variants.map(toCanonicalSchema) })
});

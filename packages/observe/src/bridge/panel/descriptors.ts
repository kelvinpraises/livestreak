// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// WAVE 4: observe already models a JSON-schema control catalog (CatalogFunction.input is a
// DescriptorValueSchema — the donor of record for the canonical JsonSchema). This flattens the
// projected ControlsView (cells[].functions[], with disabled/label/scope already resolved) into the
// canonical `@livestreak/schema` FunctionDescriptor, mapping observe's JsonSchema onto the canonical
// one. Pure read/projection — no run/worker/bus behavior changes.
//
// The two schema shapes are structurally identical (same type union + {properties:[{name,value,help}],
// items, variants}); we deep-rebuild rather than cast so the emitted descriptor is a clean,
// JSON-serializable canonical object for WSS leg B.

import type { FunctionDescriptor, JsonSchema, CapabilityScope } from "@livestreak/schema";
import { bridgeActionScope } from "@livestreak/schema";

import type { JsonSchema as ObserveJsonSchema } from "#run/control/catalog.js";
import type { ControlFunctionView, ControlsView } from "./types.js";

// --- exports ---

export const projectObserveDescriptors = (controls: ControlsView): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];

  for (const cell of controls.cells) {
    for (const fn of cell.functions) {
      descriptors.push(toDescriptor(fn, cell.kind));
    }
  }

  return descriptors;
};

// --- helpers ---

const toDescriptor = (fn: ControlFunctionView, cellKind: string): FunctionDescriptor => ({
  name: fn.name,
  label: fn.label ?? fn.name,
  // Console scope-unification (wave 5): emit the uniform granular console scope `bridge:action:<name>`
  // so the host authorizes the projected scope directly with no downstream scope normalization. The
  // package-internal `fn.scope` stays on the control catalog for local use.
  scope: `${bridgeActionScope}:${fn.name}` as CapabilityScope,
  // observe cells are the descriptor target (kind is widened `string` in the canonical type, which
  // explicitly admits observe cell-kinds).
  target: { kind: cellKind },
  disabled: fn.disabled,
  ...(fn.disabledReason === undefined ? {} : { disabledReason: fn.disabledReason }),
  ...(fn.input === undefined ? {} : { inputSchema: toCanonicalSchema(fn.input) })
});

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

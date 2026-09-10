// Canonical FunctionDescriptor + JsonSchema for the Remote Bridge Console auto-UI (Objective 4, P1/P5).
//
// Every bridge describes its functions+inputs UNIFORMLY so the app can auto-render forms. The shape is
// lifted VERBATIM from observe's `DescriptorValueSchema` (the donor of record,
// observe/src/pipeline/shared.ts) — a plain, JSON-serializable data shape, because descriptors travel
// over WSS leg B to the browser renderer. See scope-foundations.md (C2). NOT an Effect Schema AST
// (that would lose serializability over the wire).

import type { CapabilityScope } from "./capability.js";

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "union"
  | "unknown";

export interface JsonSchema {
  readonly type: JsonSchemaType;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly values?: readonly string[]; // enum members
  readonly properties?: readonly JsonSchemaProperty[]; // object fields
  readonly items?: JsonSchema; // array element
  readonly variants?: readonly JsonSchema[]; // union members
}

export interface JsonSchemaProperty {
  readonly name: string;
  readonly value: JsonSchema;
  readonly help: string;
}

/** Remote console package tab — one board + function tree per package. */
export type ConsolePackage = "observe" | "options" | "bookmaker" | "steward";

export type FunctionNodeKind = "group" | "action";

// What the console attaches a trigger button to. `kind`/`side` are widened `string` so observe's
// cell-kinds and options'/bookmaker's market/vault/nft targets all fit one cross-package type;
// packages may narrow locally and assign into this.
export interface FunctionDescriptorTarget {
  readonly kind: string; // "market" | "vault" | "nft" | "lvst" | "global" | (observe cells) ...
  readonly marketId?: string;
  readonly vaultId?: string;
  readonly side?: string; // "yes" | "no"
  readonly tokenId?: string;
}

// The cross-package function the console renders. Superset of observe's CatalogFunction (which has
// `scope` but no `target`) and options' OptionsFunctionView (which has `target` but a degenerate
// string `input`). `target` optional (observe has none); `inputSchema` is the auto-form source.
//
// Tree fields (`id`, `parentId`, `package`, `visible`) drive configurator UX: the full catalog may
// exist while the UI hides nodes not on the active configurator path.
export interface FunctionDescriptor {
  /** Stable unique id across all packages, e.g. `observe.system.config.configure`. */
  readonly id: string;
  /** Parent configurator/group id; omitted for top-level roots within a package tab. */
  readonly parentId?: string;
  readonly package: ConsolePackage;
  readonly name: string;
  readonly label: string;
  readonly scope: CapabilityScope; // authz — matched by the capability matcher
  readonly target?: FunctionDescriptorTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly inputSchema?: JsonSchema;
  /** When false the UI hides this node (configurator visibility layer). Defaults true if omitted. */
  readonly visible?: boolean;
  /** Sibling sort order within the same parent. */
  readonly order?: number;
  /** Group nodes organize children; action nodes are callable. */
  readonly nodeKind?: FunctionNodeKind;
}

/** Fill tree metadata when projecting legacy flat descriptors during migration. */
export const withDescriptorIdentity = (
  descriptor: Omit<FunctionDescriptor, "id" | "package"> & {
    readonly id?: string;
    readonly package?: ConsolePackage;
  },
  defaults: { readonly package: ConsolePackage; readonly idPrefix?: string }
): FunctionDescriptor => ({
  ...descriptor,
  id:
    descriptor.id ??
    `${defaults.package}.${defaults.idPrefix ?? "fn"}.${descriptor.name}`,
  package: descriptor.package ?? defaults.package,
  visible: descriptor.visible ?? true
});

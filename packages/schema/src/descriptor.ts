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
export interface FunctionDescriptor {
  readonly name: string;
  readonly label: string;
  readonly scope: CapabilityScope; // authz — matched by the capability matcher
  readonly target?: FunctionDescriptorTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly inputSchema?: JsonSchema;
}

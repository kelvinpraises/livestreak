import type { CapabilityScope } from "#scope/scopes.js";

export type { CapabilityScope } from "#scope/scopes.js";

export type RegistryDescriptorKind = "capture" | "process" | "publish";

export type RegistryCommandScope = CapabilityScope;

export type RegistryCommandResultKind = "artifact" | "state-patch";

export type DescriptorValueType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "union"
  | "unknown";

export interface DescriptorValueSchema {
  readonly type: DescriptorValueType;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly values?: readonly string[];
  readonly properties?: readonly RegistryPropertyDescriptor[];
  readonly items?: DescriptorValueSchema;
  readonly variants?: readonly DescriptorValueSchema[];
}

export interface RegistryPropertyDescriptor {
  readonly name: string;
  readonly value: DescriptorValueSchema;
  readonly help: string;
}

export interface RegistryFlagDescriptor {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly value: DescriptorValueSchema;
  readonly help: string;
  readonly examples?: readonly string[];
  readonly appliesTo?: readonly string[];
}

export interface RegistryCommandDescriptor {
  readonly name: string;
  readonly scope: RegistryCommandScope;
  readonly input?: DescriptorValueSchema;
  readonly output?: DescriptorValueSchema;
  readonly resultKind?: RegistryCommandResultKind;
  readonly help: string;
  readonly examples?: readonly string[];
  readonly appliesTo?: readonly string[];
}

export interface RegistryDescriptorBase<Kind extends RegistryDescriptorKind> {
  readonly kind: Kind;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly capabilityScopes: readonly CapabilityScope[];
  readonly flags: readonly RegistryFlagDescriptor[];
  readonly commands: readonly RegistryCommandDescriptor[];
}

export interface StageHealth {
  readonly status: "idle" | "starting" | "running" | "degraded" | "failed" | "stopped";
  readonly message?: string;
  readonly updatedAtMs: number;
}

export interface StageHealthSnapshotBase<Stage extends RegistryDescriptorKind> extends StageHealth {
  readonly stage: Stage;
  readonly descriptorId: string;
}

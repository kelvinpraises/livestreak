import { Schema } from "effect";

// --- exports ---

export const AaOperationKind = Schema.Literal(
  "user_operation",
  "safe_module_call",
  "session_key_setup"
);

export type AaOperationKind = Schema.Schema.Type<typeof AaOperationKind>;

export const AaSponsorshipMode = Schema.Literal("none", "dev_open", "tenant_quota", "paymaster_signed");

export type AaSponsorshipMode = Schema.Schema.Type<typeof AaSponsorshipMode>;

export const AaChainDescriptor = Schema.Struct({
  chainId: Schema.NonNegativeInt,
  name: Schema.NonEmptyString,
  entryPoint: Schema.NonEmptyString,
  safeModule: Schema.optional(Schema.NonEmptyString),
  bundlerPath: Schema.NonEmptyString,
  rpcUrl: Schema.optional(Schema.NonEmptyString)
});

export type AaChainDescriptor = Schema.Schema.Type<typeof AaChainDescriptor>;

export const AaCapabilityDescriptor = Schema.Struct({
  version: Schema.Literal("0.1.0"),
  hostId: Schema.NonEmptyString,
  sponsorshipMode: AaSponsorshipMode,
  supportedOperations: Schema.Array(AaOperationKind),
  paymasterPath: Schema.NonEmptyString,
  chains: Schema.Array(AaChainDescriptor)
});

export type AaCapabilityDescriptor = Schema.Schema.Type<typeof AaCapabilityDescriptor>;

export const AaBundlerProxyRequest = Schema.Struct({
  chainId: Schema.NonNegativeInt,
  jsonRpc: Schema.Record({ key: Schema.String, value: Schema.Unknown })
});

export type AaBundlerProxyRequest = Schema.Schema.Type<typeof AaBundlerProxyRequest>;

export const AaBundlerProxyResult = Schema.Struct({
  chainId: Schema.NonNegativeInt,
  jsonRpc: Schema.Record({ key: Schema.String, value: Schema.Unknown })
});

export type AaBundlerProxyResult = Schema.Schema.Type<typeof AaBundlerProxyResult>;

export const AaPaymasterRequest = Schema.Struct({
  chainId: Schema.NonNegativeInt,
  userOperation: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  sponsorshipHint: Schema.optional(Schema.NonEmptyString)
});

export type AaPaymasterRequest = Schema.Schema.Type<typeof AaPaymasterRequest>;

export const AaPaymasterResult = Schema.Struct({
  chainId: Schema.NonNegativeInt,
  paymasterAndData: Schema.NonEmptyString,
  validUntil: Schema.optional(Schema.Number),
  validAfter: Schema.optional(Schema.Number)
});

export type AaPaymasterResult = Schema.Schema.Type<typeof AaPaymasterResult>;

import { Schema } from "effect";

// --- exports ---

export const HostAccountTier = Schema.Literal("dev", "test", "standard", "enterprise");

export type HostAccountTier = Schema.Schema.Type<typeof HostAccountTier>;

export const HostApiKeyDescriptor = Schema.Struct({
  keyId: Schema.NonEmptyString,
  tenantId: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  createdAtMs: Schema.Number,
  expiresAtMs: Schema.Union(Schema.Number, Schema.Null)
});

export type HostApiKeyDescriptor = Schema.Schema.Type<typeof HostApiKeyDescriptor>;

export const HostTenantDescriptor = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  displayName: Schema.NonEmptyString,
  accountTier: HostAccountTier,
  apiKeys: Schema.Array(HostApiKeyDescriptor)
});

export type HostTenantDescriptor = Schema.Schema.Type<typeof HostTenantDescriptor>;

export const HostAccountDescriptor = Schema.Struct({
  accountId: Schema.NonEmptyString,
  tenantId: Schema.NonEmptyString,
  accountTier: HostAccountTier,
  displayName: Schema.NonEmptyString
});

export type HostAccountDescriptor = Schema.Schema.Type<typeof HostAccountDescriptor>;

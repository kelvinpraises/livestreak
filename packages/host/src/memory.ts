import { Schema } from "effect";

// Steward memory records — host-DB-backed durable memory. POST /memory/records remembers a
// subject's findings/decisions; GET /memory/records recalls them as plain JSON any agent can
// parse. The DB layer is Turso-ready via DATABASE_URL (see host infrastructure/database).

export const MemoryRecordInput = Schema.Struct({
  subjectKind: Schema.NonEmptyString,
  subjectId: Schema.NonEmptyString,
  marketId: Schema.optional(Schema.NonEmptyString),
  vaultId: Schema.optional(Schema.NonEmptyString),
  findingIds: Schema.Array(Schema.String),
  decisionActions: Schema.Array(Schema.String),
  evidenceRefs: Schema.optional(Schema.Array(Schema.String)),
  atMs: Schema.Number
});

export type MemoryRecordInput = Schema.Schema.Type<typeof MemoryRecordInput>;

export const MemoryRecordDto = Schema.Struct({
  id: Schema.Number,
  ...MemoryRecordInput.fields
});

export type MemoryRecordDto = Schema.Schema.Type<typeof MemoryRecordDto>;

export const MemoryRecallResponse = Schema.Struct({
  records: Schema.Array(MemoryRecordDto)
});

export type MemoryRecallResponse = Schema.Schema.Type<typeof MemoryRecallResponse>;

export const MemoryDescriptorAdvert = Schema.Struct({
  recordsAvailable: Schema.Boolean
});

export type MemoryDescriptorAdvert = Schema.Schema.Type<typeof MemoryDescriptorAdvert>;

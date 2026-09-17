import { Schema } from "effect";

// Steward forum — host-DB-backed coordination surface. Steward host actions (openThread /
// appendMessage / annotate) land here as messages about a subject; GET lists them as plain
// JSON any agent can read.

export const ForumMessageKind = Schema.Literal("thread", "message", "annotation");

export type ForumMessageKind = Schema.Schema.Type<typeof ForumMessageKind>;

export const ForumMessageInput = Schema.Struct({
  kind: ForumMessageKind,
  subjectKind: Schema.NonEmptyString,
  subjectId: Schema.NonEmptyString,
  marketId: Schema.optional(Schema.NonEmptyString),
  vaultId: Schema.optional(Schema.NonEmptyString),
  stewardId: Schema.optional(Schema.NonEmptyString),
  findingId: Schema.optional(Schema.NonEmptyString),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  atMs: Schema.Number
});

export type ForumMessageInput = Schema.Schema.Type<typeof ForumMessageInput>;

export const ForumMessageDto = Schema.Struct({
  id: Schema.Number,
  ...ForumMessageInput.fields
});

export type ForumMessageDto = Schema.Schema.Type<typeof ForumMessageDto>;

export const ForumListResponse = Schema.Struct({
  messages: Schema.Array(ForumMessageDto)
});

export type ForumListResponse = Schema.Schema.Type<typeof ForumListResponse>;

import { Schema } from "effect";

// --- exports ---

export const ForumMessageAuthorKind = Schema.Literal("steward", "observer", "system");

export type ForumMessageAuthorKind = Schema.Schema.Type<typeof ForumMessageAuthorKind>;

export const ForumMessageAuthor = Schema.Struct({
  kind: ForumMessageAuthorKind,
  ref: Schema.NonEmptyString
});

export type ForumMessageAuthor = Schema.Schema.Type<typeof ForumMessageAuthor>;

export const ForumMessage = Schema.Struct({
  messageId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
  author: ForumMessageAuthor,
  body: Schema.NonEmptyString,
  createdAtMs: Schema.Number
});

export type ForumMessage = Schema.Schema.Type<typeof ForumMessage>;

export const ForumThread = Schema.Struct({
  threadId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  stewardId: Schema.optional(Schema.NonEmptyString),
  observeRef: Schema.optional(Schema.NonEmptyString),
  createdAtMs: Schema.Number,
  updatedAtMs: Schema.Number
});

export type ForumThread = Schema.Schema.Type<typeof ForumThread>;

export const ForumThreadRecord = Schema.Struct({
  thread: ForumThread,
  messages: Schema.Array(ForumMessage)
});

export type ForumThreadRecord = Schema.Schema.Type<typeof ForumThreadRecord>;

export const ForumCreateThreadRequest = Schema.Struct({
  title: Schema.NonEmptyString,
  stewardId: Schema.optional(Schema.NonEmptyString),
  observeRef: Schema.optional(Schema.NonEmptyString),
  initialMessage: Schema.optional(
    Schema.Struct({
      author: ForumMessageAuthor,
      body: Schema.NonEmptyString
    })
  )
});

export type ForumCreateThreadRequest = Schema.Schema.Type<typeof ForumCreateThreadRequest>;

export const ForumAppendMessageRequest = Schema.Struct({
  author: ForumMessageAuthor,
  body: Schema.NonEmptyString
});

export type ForumAppendMessageRequest = Schema.Schema.Type<typeof ForumAppendMessageRequest>;

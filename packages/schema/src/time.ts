import { Schema } from "effect";

export const TimePoint = Schema.Struct({
  wallClockMs: Schema.Number,
  mediaTimeMs: Schema.optional(Schema.Number),
  sourceTimeMs: Schema.optional(Schema.Number),
  frameIndex: Schema.Number,
  renderTimeMs: Schema.optional(Schema.Number),
  eventTimeMs: Schema.optional(Schema.Number),
  chainTimeMs: Schema.optional(Schema.Number),
  proofTimeMs: Schema.optional(Schema.Number)
});

export type TimePoint = Schema.Schema.Type<typeof TimePoint>;

export const nowTimePoint = (frameIndex = 0): TimePoint => ({
  wallClockMs: Date.now(),
  frameIndex
});

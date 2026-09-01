import { Schema } from "effect";

export const OutputMode = Schema.Literal("file", "local", "simulcast");

export type OutputMode = Schema.Schema.Type<typeof OutputMode>;

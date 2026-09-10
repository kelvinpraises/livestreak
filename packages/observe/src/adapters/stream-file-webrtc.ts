import { Effect } from "effect";
import {
  streamFileToWebRtcEffect,
  type StreamFileToWebRtcInput,
  type StreamFileToWebRtcResult
} from "#pipeline/publish/sinks/local/file-stream.js";

/** Promise wrapper for CLI/tests — adapters/ is exempt from the src effect-purity scan. */
export const streamFileToWebRtc = (
  input: StreamFileToWebRtcInput
): Promise<StreamFileToWebRtcResult> => Effect.runPromise(streamFileToWebRtcEffect(input));

export type { StreamFileToWebRtcInput, StreamFileToWebRtcResult };

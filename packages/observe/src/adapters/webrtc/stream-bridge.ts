import {
  streamFileToWebRtcEffect,
  type StreamFileToWebRtcInput,
  type StreamFileToWebRtcResult
} from "../../pipeline/publish/sinks/local/file-stream.js";
import {
  createFileWebRtcStream,
  type CliStreamFileHandle,
  type CliStreamFileInput
} from "./cli-stream-entry.js";
import type { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";

/**
 * Unified export surface for observe + CLI.
 *
 * - Effect callers pass `{ filePath, streamId, signaling }` (observe tests/runtime).
 * - CLI callers pass `{ videoPath, marketId, signaling }` and get a Promise handle.
 */
const isCliInput = (input: StreamFileToWebRtcInput | CliStreamFileInput): input is CliStreamFileInput =>
  "videoPath" in input;

export function streamFileToWebRtc(
  input: StreamFileToWebRtcInput
): Effect.Effect<StreamFileToWebRtcResult, LiveStreakError>;
export function streamFileToWebRtc(input: CliStreamFileInput): Promise<CliStreamFileHandle>;
export function streamFileToWebRtc(
  input: StreamFileToWebRtcInput | CliStreamFileInput
): Effect.Effect<StreamFileToWebRtcResult, LiveStreakError> | Promise<CliStreamFileHandle> {
  if (isCliInput(input)) {
    return createFileWebRtcStream(input);
  }
  return streamFileToWebRtcEffect(input);
}

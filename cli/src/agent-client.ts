// Public agent-control client — the ONE supported import for outside processes.
//
// An outside developer installs the packed CLI artifact and imports ONLY this
// path (`@livestreak/cli/agent-client`). Never reach into `gateway/remote/` or
// other `cli/src` privates: those are workspace internals and may move.
// The signer stays in the local `livestreak remote open` gateway; this client
// redeems a pairing grant and calls only scope-permitted actions through Host.

export {
  classifyRemoteError,
  createRemoteUiClient,
  type RemoteCallOutcome,
  type RemoteDriveTarget,
  type RemoteUiClient,
  type RemoteUiClientOptions
} from "./gateway/remote/ui-client.js";
export type { FunctionDescriptor } from "@livestreak/schema";

/** Stable alias: one name for docs and examples to use. */
export { createRemoteUiClient as createAgentClient } from "./gateway/remote/ui-client.js";

// Reviewed media orchestration: the bot-fed drive sequence (watch proof before
// goLive, funding continuity, caller-owned frame pump). Bundled with the entry.
export {
  generateCounterFrames,
  IngestPumpError,
  runRemoteDrive,
  type IngestDriveInput,
  type IngestPump,
  type RemoteDriveInput,
  type RemoteDriveResult,
  type RemoteDriveStep
} from "./gateway/remote/driver.js";

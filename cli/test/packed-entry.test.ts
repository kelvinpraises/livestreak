import { describe, expect, it } from "vitest";
import * as src from "../src/agent-client.js";
import * as packed from "../dist/agent-client.js";
import type * as Pub from "../agent-client.js";
import type * as Src from "../src/agent-client.js";

// Two-way parity: the shipped declarations must match the source surface exactly.
// A drifted mirror fails here at typecheck time, not in a clean consumer.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _fd: Equal<Pub.FunctionDescriptor, Src.FunctionDescriptor> = true;
const _opts: Equal<Pub.RemoteUiClientOptions, Src.RemoteUiClientOptions> = true;
const _outcome: Equal<Pub.RemoteCallOutcome, Src.RemoteCallOutcome> = true;
const _client: Equal<Pub.RemoteUiClient, Src.RemoteUiClient> = true;
const _ingestIn: Equal<Pub.IngestDriveInput, Src.IngestDriveInput> = true;
const _driveIn: Equal<Pub.RemoteDriveInput, Src.RemoteDriveInput> = true;
const _driveOut: Equal<Pub.RemoteDriveResult, Src.RemoteDriveResult> = true;
const _step: Equal<Pub.RemoteDriveStep, Src.RemoteDriveStep> = true;
const _pump: Equal<Pub.IngestPump, Src.IngestPump> = true;
const _driveFn: Equal<typeof Pub.runRemoteDrive, typeof Src.runRemoteDrive> = true;
const _framesFn: Equal<typeof Pub.generateCounterFrames, typeof Src.generateCounterFrames> = true;
const _agentFn: Equal<typeof Pub.createAgentClient, typeof Src.createAgentClient> = true;
const _uiFn: Equal<typeof Pub.createRemoteUiClient, typeof Src.createRemoteUiClient> = true;
const _classifyFn: Equal<typeof Pub.classifyRemoteError, typeof Src.classifyRemoteError> = true;

const EXPECTED = [
  "IngestPumpError",
  "classifyRemoteError",
  "createAgentClient",
  "createRemoteUiClient",
  "generateCounterFrames",
  "runRemoteDrive"
];

describe("packed public entry", () => {
  it("source and built bundle expose exactly the public surface", () => {
    expect(Object.keys(src).sort()).toEqual([...EXPECTED].sort());
    expect(Object.keys(packed).sort()).toEqual([...EXPECTED].sort());
  });

  it("packed bundle rejects invalid drive input before any network use", async () => {
    const err = await packed
      .runRemoteDrive({
        sessionId: "x",
        pairingPassword: "y",
        mediaOnly: true,
        log: () => {}
      })
      .then(
        () => new Error("unexpected success"),
        (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
      );
    expect(err.message).toMatch(/mediaOnly requires the ingest block/);
  });
});

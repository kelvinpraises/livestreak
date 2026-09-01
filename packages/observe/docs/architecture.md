# @livestreak/observe Architecture

This document is for the developer who arrives with no conversation history and needs to move. It explains the architecture we want, why the folders exist, what should not be built, and how a running observe process ties the control bus to the media worker.

The short version: the kernel creates one run, one control bus, and one media worker. The bus owns the shared control board: editable settings, readonly facts, artifacts, and callable functions. The media worker owns live media state. The supervisor reads one board snapshot per worker turn and mutates worker state in one coherent place.

## Vocabulary

Use these terms in code and docs:

| Correct term | Meaning |
| --- | --- |
| `ObserveRun` | One prepared/running/stopped observe execution. |
| Kernel | The run owner. It prepares configured stages, creates the bus, mounts control surfaces, starts the worker, and applies lifecycle policy. |
| Control bus | The in-memory exchange for one run. It owns the board, callable functions, subscriptions, artifacts, and revision changes. |
| Board | The canonical shared control document for one run. It is JSON-shaped, but section-owned: system sections are owned by the kernel, stage sections are owned by stages through `describeControl`. |
| Control surface | A stage's live control connection to the bus: a Board cell definition plus live function handlers. Prepared runs mount stage cells with empty handlers; start mounts live handlers from `FrameSource.control`, `SinkAttachment.control`, or `ProcessAdapter.control`. |
| Function | A callable control-plane operation exposed by a control surface and invoked through the bus, such as `capture:browser:inspectTargets`. |
| Catalog | Static metadata describing what can be created: stage ids, config shapes, function scopes, inputs, outputs, and artifact kinds. |
| Shape | A generic value description used by catalog metadata. It is not the canonical shared `/schema` package. |
| Gateway | External authority boundary. Future CLI/host-side owner of authentication, sessions, transport, and caller identity. Turns identity into grants and delegates to Bridge. Not implemented in observe yet. |
| Bridge | Internal observe-facing operator API. Transportless, auth-provider agnostic. Receives caller/grant context from Gateway, delegates authorization to `scope/`, reads Board, projects Controls (Board-only or catalog-enriched via `ControlPanel`), calls functions, fetches Artifacts, and subscribes to events. Delegates to `ObserveRuntime`. Implemented in `src/bridge/`. Bridge is the local callable API, not an authentication boundary. |
| `CapabilityScope` | Authorization scope grammar owned by `scope/scopes.ts`. Exact scopes (`bridge:board:read`), prefix wildcards (`capture:browser:*`), or global `*`. Pipeline descriptors declare scopes but do not own the grammar. |
| `CapabilityGrant` | Observe authorization grant evaluated by `scope/`. Carries holder identity, scope list, expiry, and revocation state. External gateway authenticates callers and supplies grants; observe scope authorizes. |
| Media worker | The live worker attached to one `ObserveRun`. It owns stage handles, tracks, cursors, inflight work, memory, storage, and sink progress. |
| Supervisor | The decision maker inside the media worker. Each turn, it reconciles control policy with worker state. |
| Worker state | The concrete runtime facts: resident items, spilled ranges, cursors, stage health, epochs, markers, sink finalize state. |
| Track | An ordered runtime lane inside worker state. Tracks are not a standalone pipeline subsystem. |
| Cursor | A named consumer position inside a track. Process and sinks advance cursors only after successful work. |
| Manifest | The declared publish layout that tells sinks what tracks exist and how to consume them. |
| Marker | A timeline item on `capture.video.raw`: `eos`, `pause-start`, `pause-end`, `presentation-slate`, or `discontinuity`. The nested `marker` payload is canonical; duplicated top-level `wallTimeMs` / `mediaTimeMs` exist for sorting and transport. |

Do not use these as architecture terms:

| Old term | Replacement |
| --- | --- |
| Port / ControlPort | Control surface |
| registerPort | mountSurface |
| port-owned function | surface-owned function |
| frame bus | media worker, worker state, or control plane, depending on meaning |
| frame worker | media worker |
| track pipeline | supervised media worker with tracks |
| publish.write | sink pump and finalize contract |
| unbounded track | ordered track with budget and overflow policy |

## Reference Shape

```text
src/
  index.ts
  builtins.ts

  adapters/
    ffmpeg/
      bytes.ts
      process.ts
      probe.ts
      index.ts

  pipeline/
    capture/
      file/
      browser/
        page/
          types.ts
          adapter.ts
          target-detection.ts
        control/
          config.ts
          controls.ts
          live-pause.ts
          preview.ts
          preview-encoding.ts
          payloads.ts
          surface.ts
        descriptor.ts
        config.ts
        cell.ts
        source.ts
        timing.ts
        driver.ts
        index.ts
      iptv/
      synthetic/
      registry.ts
      types.ts
    process/
      football/
      registry.ts
      types.ts
    publish/
      encoder/
      sinks/
        file/
        local/
        simulcast/
      registry.ts
      types.ts
    registry.ts
    shared.ts

  run/
    control/
      catalog.ts
      board/
        model.ts
        patch.ts
        settings.ts
        worker-view.ts
        worker-snapshot.ts
        index.ts
      system/
        pause.ts
        run.ts
      bus/
        calls.ts
        bus.ts
        types.ts
        index.ts
        subscriptions.ts
        artifacts.ts
        registry.ts
    worker/
      capture-pull.ts
      lifecycle.ts
      live-pause.ts
      prepare.ts
      state.ts
      supervisor.ts
      pumps.ts
      sink-presentation.ts
      snapshot.ts
      timeline.ts
      worker.ts
      wake.ts
    kernel.ts
    run.ts
    store.ts
    runtime.ts

  bridge/
    bridge.ts
    types.ts
    index.ts
    panel/
      project.ts
      types.ts
      index.ts

  scope/
    scopes.ts
```

This is the target house shape. It respects the current stage families under `pipeline/`, keeps run lifecycle under `run/`, keeps authorization in `scope/`, and keeps bridge panel projection under `bridge/panel/`.

### Barrel rule

A folder gets exactly one `index.ts` (re-exports only, zero logic) when code **outside** the folder imports it as a unit. That barrel is the sole external entry point — outside code imports `#path/folder/index.js`, never a deep file inside a barreled folder. Folders that are single-file, or leaf driver folders reached only through a parent registry, get no barrel. A barrel must not re-export anything the architecture marks internal beyond what its consumers actually use.

| Folder | Barrel | Notes |
| --- | --- | --- |
| `adapters/ffmpeg` | yes | kept |
| `bridge`, `bridge/panel` | yes | kept |
| `pipeline/capture` | yes | stage root: `registry`, `types`, `pause` |
| `pipeline/capture/browser` | yes | kept |
| `pipeline/capture/file`, `synthetic`, `iptv` | no | registry-leaf drivers |
| `pipeline/process`, `pipeline/publish` | yes | stage roots |
| `pipeline/timeline` | yes | kept |
| `run/config`, `run/control/board`, `run/control/bus` | yes | kept |
| `run/control` | yes | root barrel for `catalog`, `board`, `bus`, `system` |
| `run/control/system` | no | exported through `run/control/index.js` |
| `run/worker` | no | worker internals are not public; kernel deep-imports intentionally |
| `scope` | no | single file (`scopes.ts`) |

Pipeline ESLint still allows only `#run/control/bus/calls.js` and `#run/control/bus/types.js` from `pipeline/**` (not the bus barrel path).

Do not add `pipeline/track/` for this design. Tracks are not a reusable pipeline package here. They are runtime state owned by `run/worker/state.ts`. If capture, process, or publish can import a `TrackStack` and create its own queue, the architecture has already split in the wrong place.

## Public API (`src/index.ts`)

The package root is a deliberate product and extension-contract barrel. External callers (CLI, gateway, stage authors, bridge clients) should import from the package root. Observe-internal tests and implementation may import `#run/...`, `#pipeline/...`, or `#bridge/...` paths directly.

**Root exports include:**

- **Run lifecycle** — `makeObserveRun`, `browserCaptureRunConfig`, `fileCaptureRunConfig`, `prepareObserveRun`, `startObserveRun`, `startObserveRunAsync`, `createObserveRuntime`, `createRunStore`, store helpers, kernel/runtime/store types.
- **Builtins resolver** (`builtins.ts`) — registry + driver resolution only: `builtInObserveRegistry`, `getBuiltInCaptureDriver`, `getBuiltInSinkDriver`, `BuiltInCaptureDriverId`, `BuiltInSinkDriverId`. File implementations are reached only through the getters; concrete file driver factories are **not** root-exported.
- **Bridge** — `createObserveBridge`, `evaluateBridgeAuthorization`, bridge scope constants, bridge input/output/caller types, panel projection (`projectBoardControls`, `projectControlPanelControls`, `ControlsView`).
- **Scope / authorization** — `CapabilityScope`, `CapabilityGrant`, grant helpers, `hasScope`, `hasAnyScope`, `requireScope`, `requireAnyScope`. External gateway authenticates; observe scope authorizes.
- **Control protocol** — `ControlCallEnvelope`, `ControlCallResult`, `ControlArtifact`, `ControlFunctionResult`, `ControlSurface`, `ControlCellDefinition`, `ControlPanel`, subscription types, `buildControlCatalog`, board read model (`Board`, `BoardCell`, `createInitialBoard`).
- **System operation scopes** — `systemRunStopScope`, `systemPausePauseScope`, `systemPauseResumeScope`, `systemPauseSetPresentationScope` (for bridge/UI clients calling run control functions).
- **Stage extension contracts** — capture/process/publish registries, descriptor types, `CaptureDriver`, `FrameSource`, `ProcessPack`, `SinkDriver`, pause/live control contracts.
- **Browser capture (adapter injection)** — `browserCaptureDescriptor`, `createBrowserCaptureDriver`, page adapter factories, config validation, browser command scope constants, preview artifact payload types.

**Not root-exported (internal):**

- Control bus implementation — `createControlBus`, `mountSurfaceRegistry`, `mergeBoardCellOnSurfaceMount`, surface registry helpers.
- Board mutation/applicator — `applyBoardPatch`, `validateBoardSettings`, `projectWorkerControlView`, `applyWorkerSnapshotToBoard`, system surface factories.
- Worker internals — anything under `run/worker/`.
- Concrete file capture/sink factories and synthetic capture.
- Browser split helpers — `describeBrowserCaptureCell`, `createBrowserCaptureFrameSource`, `createBrowserCaptureControlSurface`, payload decoders.

`ControlSurface` remains public as a stage-author contract for exposing control surfaces on capture drivers. Bus mount/merge helpers are internal.

Do **not** re-export individual file capture or file sink driver modules from `index.ts`. Stage discovery for browser uses `builtInObserveRegistry` or `browserCaptureDescriptor` from the browser export. Tests and internal code may import `#pipeline/...` paths directly.

## CLI-ready observe edge

A future CLI or Gateway host should integrate through public observe APIs only:

```text
createObserveRuntime / createObserveBridge
prepareRun → startRun → readBoard / readPanel / readControls
callFunction → getArtifact (by artifact id)
subscribeBoard / subscribeArtifacts (optional)
awaitRun
```

CLI/Gateway must **not** import worker, control-bus, board patch, or pipeline internals. `@livestreak/core` owns error serialization via `serializeLiveStreakError`, `serializeUnknownError`, and `isLiveStreakError`.

Contract expectations:

- Board and panel are read models for operator intent and stage settings — not worker state.
- Rich function payloads live in Artifacts; fetch them by opaque artifact id via `getArtifact`.
- Board, panel, and controls must not embed artifact payloads; projected `refs` are optional and remain id-only strings when present.
- Bridge callers must supply identity/grants (or trusted local caller); observe scope authorizes scopes.
- Public edge contract tests live in `test/edge/public-edge-contract.test.ts` and import only from `#index.js` plus test helpers.
- Browser control/artifact edge coverage uses an injected memory sink to isolate preview and `getArtifact` behavior; it does not prove browser → MP4 export.
- File export is covered separately by the file capture → file sink public runtime test (Scenario B).
- Product CLIs should choose real sink drivers for export commands; tests may inject fakes or memory sinks.

## Observe Config Contract

Canonical v1 observe run config (JSON-friendly envelope validated before kernel prepare/start):

```json
{
  "runId": "run_01",
  "capture": {
    "driverId": "file",
    "config": { "path": "/input.mp4" }
  },
  "process": null,
  "sink": {
    "driverId": "file",
    "instanceId": "file-export",
    "config": { "path": "/output.mp4" }
  }
}
```

Contract notes:

- `driverId` on capture and sink is the registry id for built-in or injected stage drivers.
- `packId` on process is the registry id for process packs when `process` is not `null`.
- `instanceId` on sink is the board/sink instance id; the kernel defaults to `file-export` for the current file sink path when omitted.
- `config` on each stage belongs to that stage; run/kernel validates only the outer envelope via `validateObserveRunConfig`, then delegates to stage validators during prepare.
- Public run config uses singular `sink`.
- Internal worker snapshots may use `sinks` maps keyed by sink instance id — that is worker/runtime state, not public config.
- Do not expose `sinks[]` in public config until kernel multi-sink attach/finalize support exists.
- Unknown top-level fields are tolerated for forward compatibility but ignored by this slice.

Public API: `validateObserveRunConfig`, `makeObserveRun`, and `ObserveRuntime.prepareRun` validate the envelope. `fileCaptureRunConfig` and `browserCaptureRunConfig` are pure constructors that produce canonical shapes; validation runs at run creation or prepare.

## Top-Level Model

```text
KERNEL
  creates run scope
  resolves catalog entries
  creates CONTROL BUS (bound to one runId)
  starts MEDIA WORKER

RUN STORE
  in-memory registry of ObserveRun handles
  prepared runs keyed by run.config.runId
  active ObserveRunHandle references keyed by runId
  caller-owned; no global singleton

OBSERVE RUNTIME
  CLI/bridge-facing runtime owner inside observe
  owns scoped lifetime, RunStore, prepared runs, and active handles
  orchestrates prepare/start/stop calls, board reads, function calls, await/remove
  removeRun and removeHandle drop store references only — they do not stop the worker

CONTROL BUS
  Board (flat cells)
    revision
    catalogVersion
    cells["system:run"]
    cells["system:pause"]
    cells["system:memory"]
    cells["system:tick"]
    cells["capture:browser"]
    cells["capture:file"]
    cells["sink:file-export"]

  Catalog
    JSON Schema function metadata per cell

  Artifacts
    opaque art_<uuid> records outside Board

  Surfaces
    capture:browser
    capture:file
    system:run
    system:pause
    sink:file-export

  Functions
    capture:browser:inspectTargets
    capture:browser:setCrop
    capture:browser:setCaptureFps
    system:run:stop
    system:pause:pause
    system:pause:resume
    system:pause:setPresentation

  Artifact kinds
    browser.previewTargets

MEDIA WORKER
  Supervisor
    reads one Board snapshot per turn
    decides pump, spill, rehydrate, pause, drain, finalize, fail

  Stage pumps
    capture pump calls capture drivers
    process pump calls process adapters
    publish pump calls sink attachments

  WorkerState
    tracks, cursors, ranges, storage, inflight claims,
    stage handles, manifest, health, epochs, markers

BRIDGE
  reads Board snapshots
  subscribes to bus events
  calls bus functions
  receives command results and artifacts
```

The bus says what should happen and what each running container is publishing. The media worker knows what is actually moving. The supervisor is the only place that turns board policy into worker-state mutation.

Each `ControlBus` is constructed with an explicit `runId` and rejects `callFunction` envelopes whose `runId` does not match. `ControlCallResult.runId` always reflects the bus-bound run, not an unvalidated envelope field.

`RunStore` is the multi-run registry for observe runs. It holds prepared `ObserveRun` records and active `ObserveRunHandle` references separately. Prepared runs and active handles share the same `runId` key namespace but do not remove each other unless explicitly requested. Removing a prepared run does not interrupt an active fiber; removing an active handle only drops the store reference.

`ObserveRuntime` is the CLI/bridge-facing runtime owner inside observe. It owns a caller-provided scoped lifetime, a `RunStore`, prepared runs, and active handles. Use `createObserveRuntime()` inside `Effect.scoped` so async run fibers share one scope. `prepareRun` creates and stores a prepared run; `startRun` starts via `startObserveRunAsync` and stores the handle; `readBoard` and `callFunction` delegate to store helpers; `awaitRun` joins an active handle; `removeRun` and `removeHandle` drop store references only — they do not stop or interrupt the worker.

`startObserveRun()` remains blocking. `startObserveRunAsync()` is the low-level async start primitive; CLI/bridge code should usually call `ObserveRuntime.startRun` instead. `ObserveRuntime.stopRun` patches stop intent through the Control Bus, waits for graceful completion, and interrupts the active handle fiber after its timeout. Pause/resume functions still patch Board intent and do not interrupt the worker. `removeHandle` does not interrupt the worker fiber.

The kernel still owns one run per prepare/start invocation; `ObserveRuntime` orchestrates kernel and store for multi-run hosts without a global singleton.

## Current Code Grounding

The current `src/pipeline` types already define stage families:

- `pipeline/capture/types.ts` exposes `FrameSource.frames` as a stream of `RawFrame` with a typed `CaptureVideoPayload`.
- `pipeline/process/types.ts` exposes `ProcessInput`, `ProcessOutput`, `ProcessBatch`, and `ProcessResult`. Process adapters never take `RawFrame` directly.
- `pipeline/publish/types.ts` exposes `SinkDriver`, `SinkAttachment`, `SinkDeliveryItem`, and `SinkFinalizeResult`.
- `pipeline/capture/synthetic/driver.ts` is a real `CaptureDriver` for tests and dev harnesses. It is **not** registered in default builtins.
- Descriptor lookup uses **short ids** (`"file"`, `"synthetic"`, `"simulcast"`). Composed names like `capture:synthetic` belong in logs, scopes, and UI labels only.
- An empty process section means passthrough: no process stage, no process pump, publish reads capture tracks through manifest aliases.
- `OutputMode` is `"file" | "local" | "simulcast"`. There is no `forwarder` name.
- Generic encode helpers live under `pipeline/publish/encoder/`. Sinks deliver; encoders prepare bytes.
- `run/kernel.ts`, `run/run.ts`, `run/store.ts`, and `run/runtime.ts` are the correct homes for run lifecycle.

That means the design should not fight existing runtime code. The first real runtime model can be created cleanly under `run/control/` and `run/worker/`.

## Why `run/worker/` Exists

The media worker is not a pipeline stage. Capture acquires media. Process transforms media. Publish prepares output and sinks. The media worker owns the live graph connecting those stages for one `ObserveRun`.

Putting worker state in `pipeline/` would let stage code grow hidden queues and private lifecycle. Putting it all in `run/kernel.ts` would mix lifecycle commands with media mechanics. `run/worker/` is the smallest useful boundary: it is close to the run that owns it, but separate from the control kernel that starts and stops it.

### Worker Files

`worker.ts` is the front door. It creates or forks the media worker, owns the worker turn loop, reads board snapshots, calls the supervisor, and exposes stop/health hooks back to `run/kernel.ts`.

`state.ts` is the whole working-state picture. Tracks, cursors, resident ranges, spilled ranges, inflight claims, stage handles, publish manifest, lifecycle markers, stage health, sink progress, and memory counters live here as one model.

`supervisor.ts` is the decision maker. It reads control policy plus worker state and decides what should happen next: pump capture, process, publish, spill, rehydrate, pause, resume, drain, finalize, restart, degrade, or fail.

`pumps.ts` is the adapter bridge. It is the only place where the worker calls capture, process, and publish implementations. Stages do work, but they do not own shared worker state.

`capture-pull.ts` owns capture-stage setup and pull details that would otherwise bloat the supervisor.

`lifecycle.ts` owns lifecycle transition helpers: running, pausing, paused, resuming, stopping, draining, stopped, and failed.

`live-pause.ts` reconciles global pause intent with `FrameSource.live` pause/resume hooks.

`sink-presentation.ts` reconciles pause presentation intent with optional `SinkAttachment.presentation` hooks.

`timeline.ts` appends and reads timeline markers such as pause-start, presentation-slate, pause-end, and eos.

Spill and rehydrate are future work. When implemented, add a dedicated storage boundary under `run/worker/` so range ordering, temp paths, cleanup, and rehydration do not leak across the worker.

`snapshot.ts` converts noisy worker internals into readable health facts. UI and bridge should see facts like track depth, lag, RAM used, spill size, dropped count, current mode, and sink status. They should not receive mutable worker state.

Do not add separate `budget.ts`, `rehydrate.ts`, `drain.ts`, `cursors.ts`, `ranges.ts`, or `manifest.ts` until an implemented feature needs that owner. Keep the worker layout owner-based: one worker state model, one supervisor, one pump bridge, lifecycle helpers, pause/presentation helpers, timeline helpers, and one snapshot boundary.

## How Worker State Ties To A Running Process

`ObserveRun` owns the bus and the worker handle. `run/kernel.ts` owns lifecycle transitions. `run/control/bus/` owns the board, control surfaces, functions, artifacts, and subscriptions. `run/worker/worker.ts` owns the media turn loop. The kernel never reaches into track arrays directly. The worker never mutates board policy directly. Kernel and worker mount stage surfaces generically; they do not branch on browser/file/synthetic for control wiring.

Expected lifecycle:

```text
Board settings are the command channel.
Worker lifecycle is the truth channel.
Board status is not a command channel.
```

Kernel-only run statuses (`created`, `preparing`, `prepared`, `starting`) stay on the board until the worker's first snapshot commits `running`. After that, worker lifecycle drives board status projection for active and terminal states.

```text
makeObserveRun(config) -> Effect<ObserveRun, LiveStreakConfigError>
  -> validate envelope
  -> create initial Board
  -> create ObserveRun handle

prepare(run)
  -> validate config and grants
  -> resolve catalog entries
  -> create stage resources
  -> describeControl + mountSurface (prepared cells with empty handlers)
  -> build publish manifest
  -> create empty WorkerState
  -> publish system.run status prepared

start(run)
  -> publish system.run status starting
  -> fork media worker in the run scope
  -> worker first turn: idle -> running
  -> worker snapshot commits running to board

pause(run)
  -> update Board.system:pause.settings (requested + policy)
  -> increment board revision
  -> wake worker
  -> supervisor reads settings intent, not board status
  -> worker lifecycle: running -> pausing -> paused
  -> worker snapshot commits pausing/paused to board

resume(run)
  -> update Board.system:pause.settings.requested = false
  -> increment board revision
  -> wake worker
  -> worker lifecycle: paused -> resuming -> running
  -> worker appends pause-end

stop(run)
  -> update Board.system:run.settings.stopRequested
  -> increment board revision
  -> wake worker
  -> worker lifecycle: * -> stopping -> draining -> stopped

worker exits
  -> kernel records stopped or failed
  -> store removes or keeps run according to retention policy
```

Worker lifecycle values: `idle`, `running`, `pausing`, `paused`, `resuming`, `stopping`, `draining`, `stopped`, `failed`. The supervisor does not re-read board `system:run.status` to pull itself out of transitional worker states.

Settings intent inputs:

| Setting | Meaning |
| --- | --- |
| `system:pause.settings.requested` | Pause/resume intent |
| `system:pause.settings.*` policy fields | Pause presentation (`whilePaused`, optional `slateAssetId`) |
| `system:run.settings.stopRequested` | Stop intent |

Board settings validation runs only when settings can change: function patches that include `settings`, `bus.applyBoardPatch` when settings change, and `commitBoard` when any cell settings differ from the current board. Status-only worker snapshot commits must not fail because unrelated settings are invalid.

Every function that creates, starts, or stops runtime resources should return an Effect blueprint. `Effect.runPromise` belongs at the application edge, tests, or host, not inside library code.

When the worker changes factual lifecycle (`draining`, `stopped`, `failed`), the kernel publishes those facts into the board through a pure reducer such as `applyWorkerSnapshotToBoard` in `run/control/board/worker-snapshot.ts`. Natural EOS may move worker lifecycle to `draining` before the board catches up; commanded stop remains kernel-owned. Terminal run statuses (`stopped`, `failed`) are monotonic and must not regress from stale worker snapshots.

`validateWorkerPrepare` in `run/worker/prepare.ts` rejects unknown sink ids, unknown manifest subscriptions, and missing source tracks before the first supervisor turn. Runtime track/manifest mismatches call `failWorker` instead of silently skipping work.

`WorkerRunResult.outcome` distinguishes clean stop (`stopped`), worker failure (`failed`), and loop exhaustion (`max-turns-exceeded`). Sink finalize results are stored on worker sink state and projected through `WorkerSnapshot`.

## Control Bus: Board, Surfaces, Functions, Subscriptions

The worker should make decisions from one stable board snapshot per turn. A turn can be caused by a timer, a stage becoming ready, storage finishing a rehydrate, a sink needing work, or a board revision changing. It is not only a fixed interval.

Function calls and setting changes publish patches to the bus. The bus validates and applies them to the board, increments `revision`, and wakes the worker. The worker then reads one snapshot and reconciles. This avoids policy tearing where capture sees one setting, process sees another, and publish sees a third during the same operation.

```text
function call or setting change
  -> validate command through scope
  -> route to a live ControlSurface
  -> run the surface-owned Function
  -> Function returns artifact, board patch, or both
  -> bus applies board patch
  -> bus increments revision
  -> wake worker
  -> supervisor reads one snapshot
  -> supervisor mutates WorkerState
  -> worker emits WorkerSnapshot
  -> bus publishes worker facts into readonly board sections
  -> Bridge (internal) receives board event or reads latest snapshot
```

Subscriptions are in-memory bus subscriptions. Control surfaces use them to observe relevant board sections. The worker may be woken by subscription events, but it still makes decisions from one stable board snapshot per turn.

The Bus is not a global singleton. The kernel creates one Bus per run. Stages expose ControlSurface objects. The Bus mounts those surfaces. Prepared stage cells may advertise functions on the Board before a live surface exists; calls fail cleanly until the live surface is mounted. Stage modules import bus types and helpers; they do not import a process-wide mutable bus.

### Function calling through the control plane

A control-plane function is a callable operation exposed by a mounted ControlSurface. It is not a direct method call from Bridge to browser, file, IPTV, or sink code.

Function call path:

```text
Gateway (future, external)
  -> Bridge (internal observe API) sends ControlCallEnvelope
  -> scope/ authorizes envelope.scope against the grant
  -> Catalog confirms a catalog entry declares the function scope
  -> Bus finds one live ControlSurface that advertises the function scope
  -> Bus calls the surface-owned Function with envelope + board revision
  -> Function decodes payload using its stage-owned decoder
  -> Function reads or updates local stage state if needed
  -> Function returns ControlCallResult
  -> Bus stores artifact if present
  -> Bus validates and applies BoardPatch if present
  -> Bus publishes revision event when board changed
  -> Bridge (internal) receives ControlCallResult
```

External CLI, web, and agent callers should flow through **Gateway** later. Gateway delegates to **Bridge** inside observe. This repository implements Bridge only in the current slice; Gateway is not implemented here.

Example browser function:

```text
capture:browser:inspectTargets
  owner: capture:browser ControlSurface
  input: none
  output: browser.previewTargets artifact
  board mutation: none
```

Example browser setting function:

```text
capture:browser:setCrop
  owner: capture:browser ControlSurface
  input: crop rectangle, optional preview revision
  output: BoardPatch for cells["capture:browser"].settings
  board mutation: bus applies patch after validation
```

Example future file seek function:

```text
scope: future capture file seek scope
  owner: capture:file ControlSurface
  input: mediaTimeMs
  output: BoardPatch for cells["capture:file"].settings
  worker effect: next supervisor turn appends seek/discontinuity markers
```

This gives function calling without hardcoding browser, file, IPTV, process, or sink logic into `run/control`.

### Call results and artifacts

The board holds small shared state: status, revision, settings, policies, health, and readonly facts. It must not carry rich temporary payloads such as preview image blobs.

`run/control/bus/calls.ts` defines the bridge-facing contract:

```text
ControlCallEnvelope   // Bridge request
ControlCallResult     // immediate function response
ControlArtifact       // rich temporary payload returned by a function
```

Protocol types (`BoardPatch`, surface/function interfaces) live in `run/control/bus/types.ts`. `applyBoardPatch` stays in `run/control/board/patch.ts`.

Generic bus files:

```text
run/control/
  catalog.ts
  board/
    model.ts
    patch.ts
    settings.ts
    worker-view.ts
    worker-snapshot.ts
    index.ts
  bus/
    calls.ts
    bus.ts
    types.ts
    index.ts
    subscriptions.ts
    artifacts.ts
    registry.ts
  system/
    pause.ts
    run.ts
```

Stage-owned surface files live beside their stage implementation, not under `run/control`:

```text
pipeline/capture/browser/control/surface.ts
pipeline/capture/iptv/control/surface.ts      // future, when IPTV exposes live functions
pipeline/publish/sinks/simulcast/surface.ts   // future, when simulcast exposes live functions
```

Stages with no live functions, such as current file capture and file sink, only implement `describeControl`; they do not need empty `surface.ts` files.

`run/control/system/pause.ts` owns `system:pause:*` functions. There is no central concrete surfaces folder under `run/control`; bus protocol and registry live in `run/control/bus`, board mechanics in `run/control/board`.

Pipeline services expose source-local controls, state publishers, and surface factories. `run/control` owns only generic bus mechanics. Pipeline may import only `#run/control/bus/calls.js` and `#run/control/bus/types.js`.

Layering rule: `pipeline/**` may import generic bus protocol types only if those types are dependency-safe and do not pull in kernel or worker code. Pipeline must not import a live bus singleton, kernel, worker state, or run handle. The kernel mounts stage surfaces through `mountSurface` at prepare/start; it does not hardcode browser controls.

Patch semantics use explicit set/unset on flat board cells (JSON-safe). Example clear crop:

```json
{
  "cells": {
    "capture:browser": {
      "settings": {
        "unset": ["crop", "selectedTargetId", "cropSource", "lastPreviewRevision"]
      }
    }
  }
}
```

Worker state keeps media pull only. Live capture controls attach through mounted control surfaces at prepare/start.

Important distinctions:

| Hook / layer | Role |
| --- | --- |
| `FrameSource.live` | Source pause/resume hook used by worker/supervisor |
| `FrameSource.control` | Bus-mounted function surface used for calls, artifacts, and Board patches |
| Board | Shared settings, policy, health, and readonly facts (no preview blobs) |
| `ControlCallResult.artifact` | Immediate function response payload |
| `WorkerSnapshot` / media tracks | Runtime media worker facts |

Read-only artifact functions do not bump board revision. Mutating functions return explicit board patches; the bus bumps revision only when the patch actually changes a board section.

### Bridge Panel Contract

`bridge/panel/` is the canonical read-only projection for CLI, web, and gateway callers. Panel answers what cells exist, what state they are in, what settings and readonly facts are visible, which functions can be called, what input/output schema each function exposes, whether a function is disabled (and why), and which artifact ids are referenced. Panel does not answer how CLI formats tables, which icons or web layout to use, what worker tracks exist, what artifact payloads contain, or how authorization works.

Board remains the source of truth; Catalog enriches function metadata when available. Board cell `functions` is the live truth of what is visible and callable — Catalog only enriches those names with scope, label, description, resultKind, input, and output. Catalog-only functions are omitted unless the Board advertises them.

Panel is pure vanilla TypeScript: no Effect, I/O, worker, pipeline, or artifact payload imports. CLI, web, and Gateway may render panel output however they like; observe does not own UI layout metadata such as icons, tabs, or groups.

| Concern | Owner |
| --- | --- |
| Cell existence, status, settings, readonly facts | Board |
| Which functions are visible/active | Board cell `functions` list |
| Function labels, scopes, schemas, result kinds | Catalog when present; derived scope fallback otherwise |
| Function disabled state | Panel projection (`disabled: boolean`, optional `disabledReason` when disabled) |
| Artifact payloads | Not in panel — fetch separately via Bridge/runtime `getArtifact` |
| Artifact references | Panel `refs` exposes string ids only (for example `latestPreviewArtifactId`) |
| Worker tracks, cursors, lifecycle, pause cycles | Not in panel — internal worker state only |

`projectBoardControls(board)` projects Board only. `projectControlPanelControls(panel)` merges Catalog metadata for functions listed on each Board cell. Bridge `readControls` uses `runtime.readPanel({ includeCatalog: true })` and the catalog-aware projection.

Projection rules:

- Pure vanilla TypeScript — no Effect, I/O, worker, or pipeline imports.
- Stable cell ordering: system (`run`, `pause`, `memory`, `tick`), capture, process, sink, then unknown prefixes; lexicographic within each group.
- Function visibility comes from Board; Catalog-only functions are omitted.
- Every function emits explicit `disabled: boolean`. Enabled functions use `{ disabled: false }` without `disabledReason`. Disabled functions use `{ disabled: true, disabledReason: "..." }`.
- Disabled reasons are conservative: failed cell disables all its functions; terminal run (`stopped`/`failed`) disables mutating functions (`patch`, `patch+artifact`, `state-patch`) but not artifact/read functions.
- Output records are shallow-copied; nested JSON-shaped values may share references with Board input.

Bridge authorization always delegates to `scope/` before any runtime call. There is no injectable Bridge authorizer; observe owns authorization internally. `BridgeCaller.trusted === true` bypasses grant checks for local trusted callers after caller id validation. Otherwise `BridgeCaller.grants` carries `CapabilityGrant` records evaluated by `requireAnyScope`. Grants may be exact scopes, prefix wildcards such as `bridge:board:*` or `capture:browser:*`, or global `*`. Revoked and expired grants fail. External gateway authenticates callers and supplies caller/grant context to Bridge; it does not inject observe authorization logic. Gateway is not implemented in observe.

CLI, web, and future Gateway transports must not invent their own error JSON. Convert typed `LiveStreakError` values with `@livestreak/core` `serializeLiveStreakError` into stable, JSON-safe `SerializedLiveStreakError` payloads (`shortName`, `title`, `message`, `description`, optional `context`, optional metadata fields). Do not serialize `metadata.cause` to clients.

Pause is one lifecycle operation. Board `system:pause.settings.requested` drives worker pause/resume; presentation is separate from lifecycle.

Pause settings: `{ requested?: boolean, whilePaused?: "hold"|"slate", slateAssetId?: string }`. Validated on board commit, in `system:pause:setPresentation` decoding, and in the control catalog. `slateAssetId` is required when `whilePaused === "slate"` and forbidden otherwise. Legacy fields (`mode`, `fill`, `markDiscontinuity`) and `capture:browser.settings.livePause` are rejected.

Presentation while paused: `hold` means a live-capable sink may keep its last already-delivered visual visible. `slate` means a live-capable sink may cover with an asset referenced by `slateAssetId`. Observe does not resolve `slateAssetId` — Board carries intent, timeline records markers, and optional sink presentation hooks provide immediate live display behavior. File/export sinks may ignore presentation hooks and still receive markers later after resume/drain. No fake frames, no repeated frames, and no image bytes in Board/Panel/Controls. Sinks are not ordinarily pumped while paused (`shouldPumpSinks` excludes `pausing` and `paused`).

Optional sink presentation contract (`SinkPresentationControls` on `SinkAttachment`):

- `pausePresentation({ whilePaused, slateAssetId? })` — called once per pause cycle after pause-start markers and live source pause reconciliation, before lifecycle becomes `paused`.
- `resumePresentation()` — called once per resume cycle before `pause-end` is appended, only when pause presentation was applied for that cycle.
- Stop while paused does not call `resumePresentation`; existing stop/drain/finalize teardown remains responsible for sink cleanup.
- Runtime `system:pause:pause` / `system:pause:resume` reach optional sink presentation hooks through normal worker orchestration, not through Bridge or Panel special cases.
- Sinks without the hook are ignored; hook failures fail the worker through the normal supervisor error path.

Pause behavior: the supervisor reads `system:pause.settings` intent and owns worker lifecycle transitions (`running → pausing → paused → resuming → running`). Pause enters `paused` immediately after source pause, optional sink presentation, and marker append; sinks are not drained before pause completes, and queued media remains queued until resume, stop, or natural drain. Live capture sources reconcile through minimal `CaptureLiveControls` (`pause()` / `resume()` with no policy argument). Global `system:pause` is the only pause intent; browser capture has no per-source pause policy settings. Pull-gating in `pumpCapture` remains a fallback for non-live sources. `system:pause:setPresentation` is rejected while `requested === true`; live presentation switching during an active pause is a future sink/presentation feature, not pause lifecycle.

Pause presentation types live in `pipeline/capture/pause.ts` and `pipeline/publish/types.ts` (`SinkPausePresentation`). Timeline marker protocol types live in `pipeline/timeline/` (`TimelineMarkerKind`, `TimelineMarkerPayload`, `TimelineMarker`). Worker marker append helpers stay internal to `run/worker/timeline.ts`; sink presentation reconciliation lives in `run/worker/sink-presentation.ts`.

Timeline markers append to `capture.video.raw` only. One marker set per pause cycle (`pauseCycle` worker state guards idempotency):

- one `pause-start`
- at most one `presentation-slate` when `whilePaused === "slate"` (same turn as `pause-start`)
- one `pause-end` on resume

Memory budget controls and tick scheduler settings are not exposed on the Board until enforced. `system:memory` and `system:tick` cells are readonly diagnostics with no public functions today.

`readLastMediaTimeMs(state, trackId)` scans backward for the latest video item to populate marker `mediaTimeMs`. Marker items use discriminated `TrackItem` `{ kind: "marker", marker: TimelineMarker, wallTimeMs, mediaTimeMs? }`.

Commanded stop is implemented via `system:run:stop`. The function patches `cells["system:run"].settings.stopRequested` (and optional `stopReason`) only — it does not set lifecycle status. The worker promotes to `stopping`, appends EOS, moves to `draining` once capture ends, drains sinks, and finalizes. Natural EOS moves `running -> draining -> stopped` without `stopping`. Repeating stop while already requested is a structural board no-op. The worker waits on board wake when `lifecycle === "paused"`, and uses cooperative `Effect.yieldNow()` between active media turns.

Reliable stop:

- Stop intent is a Board settings patch via `system:run:stop`.
- `ObserveRuntime.stopRun` calls the bus function, wakes the worker, and waits for graceful completion through the active run handle.
- If the timeout expires, Runtime interrupts the active handle fiber; stage cleanup runs through Effect scopes and finalizers. Stage-specific cancellation can be added later only inside stage owners.
- Runtime and Bridge do not mutate worker internals or Board settings directly for stop.
- CLI and Gateway hosts should call Bridge or Runtime stop, not write Board JSON directly.

Reliable stop outcomes:

- `stopped`: worker drained and finalized normally
- `failed`: worker failed
- `max-turns-exceeded`: worker exceeded configured turns
- `interrupted`: runtime stop timeout interrupted the active fiber before a worker result was available

Board status for interrupted stop is `failed` with an interruption reason; `ObserveRunResult.outcome` carries the precise machine outcome. Runtime projects that status through `bus.commitBoard` after interrupt — not by mutating worker state.

Any owner-tunable runtime state must be exposed as:

1. Board cell settings
2. Catalog function input schema
3. ControlSurface function returning BoardPatch
4. Board validation
5. Worker projection if the worker needs it

Test-only fake live capture lives in `test/helpers/fake-live-capture.ts` and is injected through `ObserveRunKernelOptions.captureDriver`. It is not registered in builtins and is not exported from `src`.

## Expected Board

Board is a flat cell map. Do not nest `system.run`, `pipeline.capture.*`, or repeat `id`/`kind` inside cells unless a projection needs it.

Board `settings` are JSON-shaped plain records. Whole-board commits run `validateBoardSettings` against known field shapes before acceptance. System memory and tick cells do not expose editable settings in this pass.

```jsonc
{
  "revision": 42,
  "catalogVersion": "0.1.0",
  "cells": {
    "system:run": {
      "label": "Run",
      "status": ["running", "worker is active", 1730000000000],
      "settings": {
        "stopRequested": false
      },
      "readonly": {
        "runId": "run_01HZ...",
        "prepared": true
      },
      "functions": ["stop"]
    },
    "system:pause": {
      "label": "Pause",
      "catalog": "system:pause",
      "status": ["idle", null, 1730000000000],
      "settings": {
        "requested": false,
        "whilePaused": "hold"
      },
      "functions": ["pause", "resume", "setPresentation"]
    },
    "capture:browser": {
      "label": "Browser Capture",
      "catalog": "capture:browser",
      "status": ["running", null, 1730000000000],
      "settings": {
        "url": "https://example.com/live",
        "captureFps": 30
      },
      "readonly": {
        "sourceType": "browser",
        "sourceMode": "live",
        "health": { "status": "running" }
      },
      "functions": [
        "getPreview",
        "inspectTargets",
        "setTarget",
        "setCrop",
        "clearCrop",
        "setCaptureFps"
      ]
    },
    "sink:file-export": {
      "label": "File Export",
      "catalog": "sink:file",
      "status": ["running", null, 1730000000000],
      "settings": {
        "path": "/tmp/output.mp4",
        "subscribe": ["publish.video.rendered"],
        "required": true
      },
      "readonly": {
        "deliveredItems": 120,
        "finalized": false
      },
      "functions": []
    }
  }
}
```

Preview images and rich payloads live in Artifacts (opaque `art_<uuid>` ids), not in Board cells. Function calls return `artifactId` and may inline the full `artifact` in `ControlCallResult`.

### Artifact Contract

Artifacts are per-run and stored in that run's ControlBus in-memory map. A control-surface function returns an artifact draft; the bus assigns an opaque `art_<uuid>` id, stores the payload for that run only, notifies artifact subscribers for that run only, and returns `artifactId` plus optional inline `artifact` in `ControlCallResult`. Fetch full payloads through `runtime.getArtifact(runId, artifactId)` or `bridge.getArtifact(...)`.

| Rule | Behavior |
| --- | --- |
| Id format | Opaque `art_<uuid>` assigned at store time; do not export id factories or test reset helpers |
| Fetch input | JSON `artifactId` validated at runtime/store boundary; non-string or whitespace-only fails with `LiveStreakConfigError`: `artifactId must be a non-empty string` |
| Missing id | Unknown ids such as `art_missing` fail with `Artifact <id> not found for run <runId>` — UUID format is not validated on input |
| Cross-run access | Artifacts from run A cannot be read under run B |
| Read models | Board, Panel, and Controls must not embed artifact payloads; `refs` are optional and id-only strings when present |
| Subscriptions | `subscribeArtifacts` is per-run; unsubscribe stops later notifications |
| Bridge order | Authorization is evaluated before runtime/store work; denied callers fail before artifact id validation |
| Durability | Larger or cross-run artifact storage is future Gateway/host work, not observe now |

Board ownership rules:

| Cell id | Owner | Write path |
| --- | --- | --- |
| `system:run` | Kernel | lifecycle reducers and worker snapshot projection |
| `system:pause` | Kernel / system surface | pause/resume/setPresentation functions |
| `system:memory` | Kernel | memory policy settings functions |
| `capture:*`.settings | Capture surface | surface-owned mutating functions |
| `capture:*`.readonly | Kernel / surface reducers | worker snapshot projection and surface facts |
| `sink:*`.settings | Sink surface | surface-owned functions |
| `sink:*`.readonly | Kernel / surface reducers | worker snapshot projection and surface facts |

There are two kinds of generic shapes:

| Shape kind | Purpose |
| --- | --- |
| Static board shape | Describes the readable settings and readonly facts a surface publishes to the board. |
| Function shape | Describes the input and output of one callable function that can update state or return artifacts. |

The board is editable, but not by arbitrary JSON mutation. Writes must go through a system function or a surface-owned function. A function may return a board patch, but the bus applies the patch and owns revision changes.

Expected `system.run.status` values:

| Status | Meaning |
| --- | --- |
| `created` | Run handle exists, but resources are not prepared. |
| `preparing` | Config, grants, stage resources, manifest, and empty worker state are being created. |
| `prepared` | The graph is wired and ready, but the worker is not pumping. |
| `starting` | The worker is being forked and first pump turn is being scheduled. |
| `running` | Supervisor is allowed to pump stages according to control policy. |
| `pausing` | Transient single-turn state while live source pause is applied and pause-start markers are appended. |
| `paused` | Worker state is retained; new media pulls are held according to pause policy. Queued track items and sink backlog are preserved, not drained. |
| `resuming` | Resume was requested; worker is recording markers and enabling pumps. |
| `draining` | Stop or EOS happened; worker is flushing allowed work and sinks. |
| `stopping` | Forced stop is tearing down resources. |
| `stopped` | Worker exited cleanly and resources are closed. |
| `failed` | Run cannot continue. The snapshot must include a concrete reason. |

## Worker State

Worker state is not serialized directly over the bridge. It is kept internal and projected through `run/worker/snapshot.ts` and `bridge/panel/project.ts`.

The JSON below is **internal worker state / run snapshot shape**, not the public observe run config envelope. Public config declares one `sink` object; worker snapshots track per-instance finalize progress in a top-level `sinks` map keyed by sink instance id (for example `file-export`).

```jsonc
{
  // The run this worker belongs to. A worker never serves multiple runs.
  "runId": "run_01HZ...",

  // Last control revision the supervisor reconciled.
  "lastAppliedControlRevision": 42,

  // Worker lifecycle. Similar to control status, but this is the worker's factual state.
  "lifecycle": "running",

  // Segment or epoch changes when pause/resume, seek, restart, or discontinuity changes timeline meaning.
  "epoch": 3,

  // Stage handles are live resources created from pipeline descriptors.
  "stages": {
    // Capture source handle, health, and whether a read is in flight.
    "capture": {},

    // Process adapter handle, health, and any claimed input range.
    "process": {},

    // Publish attachment and sink handles.
    "publish": {}
  },

  // Tracks are ordered runtime lanes. They live here, not under pipeline/.
  "tracks": {
    "capture.video.raw": {
      // Ordered in-memory ranges ready for consumers.
      "residentRanges": [],

      // Future: ordered ranges stored on disk and rehydratable by a storage boundary.
      "spilledRanges": [],

      // Markers share ordering with payload items.
      "markers": [],

      // Consumers and their committed positions.
      "cursors": {
        "process:football": {},
        "sink:debug-file": {}
      },

      // Byte and age counters for supervisor pressure decisions.
      "metrics": {}
    }
  },

  // Work that has been claimed but not yet committed. Inflight ranges are pinned.
  "inflight": [],

  // Publish manifest created during prepare. Sinks validate against this.
  "manifest": {},

  // Spill files, rehydrate requests, and cleanup leases.
  "storage": {},

  // Aggregated counters used by the supervisor.
  "budget": {
    "residentBytes": 0,
    "spilledBytes": 0,
    "pinnedBytes": 0
  },

  // Internal only: sink instance id -> finalize progress. Not public config (public config uses singular "sink").
  "sinks": {},

  // Last fatal or degraded reason, if any.
  "error": null
}
```

Good worker state is one coherent picture. Bad worker state is split across capture private queues, process private queues, publish private queues, and UI caches that disagree.

## Tracks Inside Worker State

A track is an ordered lane of runtime items. A track item should carry:

- track id
- sequence or monotonic order key
- epoch
- media time
- wall time
- kind: video, audio, metadata, marker, encoded packet, render output
- payload size
- payload reference
- marker type when the item is a marker

The worker should mutate tracks through small internal functions, not through stage code:

```text
appendItem(state, trackId, item)
claimRange(state, cursorId, policy)
commitCursor(state, cursorId, range)
releaseConsumedRanges(state)
spillColdRanges(state, policy)
rehydrateNeededRange(state, cursorId, range)
appendMarker(state, trackId, marker)
```

These functions belong in `run/worker/state.ts` at first. Move them to a smaller worker-local file only when the file becomes hard to read.

Capture, process, publish, and sinks should not own track queues. They should receive inputs from the worker pump and return outputs or acknowledgements to the worker pump.

## Supervisor Turn

The supervisor turn is the core runtime algorithm.

```text
1. Read one stable Board snapshot.
2. Compare control revision to last applied revision.
3. Apply lifecycle intent: start, pause, resume, seek, stop, drain.
4. Refresh stage and sink health.
5. Release ranges consumed by all relevant cursors.
6. Measure pressure: resident bytes, pinned bytes, spill bytes, depth, oldest age, lag.
7. Rehydrate ranges needed by the next eligible consumer if memory allows.
8. Spill, drop, block, or fail according to control policy if pressure is high.
9. Pump capture if policy and budget allow.
10. Pump process if its pull policy is satisfiable.
11. Pump publish and sinks according to manifest and sink cursors.
12. Append markers for EOS, pause, resume, seek, restart, or discontinuity.
13. If EOS plus drain plus sink finalize is complete, exit cleanly.
14. Emit a worker snapshot for projection.
```

This is a cooperative model first. The worker owns shared-state mutation. Stage internals may perform async work, but committing results back into worker state happens through the supervisor-owned turn.

## Stage Pumps

`run/worker/pumps.ts` is where runtime state meets stage implementations.

Capture pump:

- calls the selected capture driver once at prepare to create a `CaptureFramePull` handle inside the run scope
- pulls at most one frame per supervisor turn through that handle
- converts source output into worker track items
- appends video, audio, metadata, and marker items to worker state
- never re-subscribes with `Stream.drop` over a cold source stream each turn

`runScopedWorkerUntilStoppedWithControl` keeps `driver.create(...)`, `CaptureFramePull`, and worker execution in the same Effect scope so file/ffmpeg streams are not closed before pumping finishes. Pass capture setup through `prepareCapture`, which returns the full `FrameSource` (descriptor, frames, health). Worker state retains those facts; `WorkerSnapshot.capture` projects descriptor metadata and the latest refreshed health each supervisor turn via `completeSupervisorTurn`.

Process pump:

- checks process pull policy from the board
- skips entirely when `control.process` is `null` (passthrough)
- claims the needed input range from worker tracks using `ProcessInput` items
- calls the process adapter with a `ProcessBatch`
- writes `ProcessOutput` values into worker tracks
- commits the cursor only after success
- records timeout, restart, skip, or failure according to policy

Process health counters use `processedBatchCount` and `outputCount`, not domain-specific names like `observationCount`.

Publish pump:

- reads the manifest and sink subscriptions
- claims publishable ranges for each sink cursor
- gives sinks track details and payloads from the manifest
- commits sink cursors only after delivery or accepted drop
- finalizes sinks during drain

Good pump code is boring: claim, call, commit. Bad pump code hides queues inside stages or commits cursors before work succeeds.

## Publish Manifest And Sinks

Sinks must not guess publish output. The worker creates a manifest during prepare, and every sink validates against it before pumping starts.

```jsonc
{
  // Manifest version so bridge and sinks can reject incompatible layouts.
  "version": 1,

  // Whether the manifest is fixed for this run. Default should be true.
  "fixedAfterPrepare": true,

  // All tracks publish may expose to sinks.
  "tracks": [
    {
      // Stable track id used by cursors and sink subscriptions.
      "id": "publish.video.rendered",

      // Human role. Sinks can ask for roles rather than internal implementation names.
      "role": "primary-video",

      // Payload kind.
      "kind": "video",

      // Payload shape or codec. Raw frames, encoded packets, JSON, etc.
      "payload": "rgba-frame",

      // Timebase used by mediaTime fields.
      "timebase": "milliseconds",

      // Whether a sink requiring canonical output must consume this track.
      "required": true
    },
    {
      "id": "publish.audio.raw",
      "role": "primary-audio",
      "kind": "audio",
      "payload": "pcm-chunk",
      "timebase": "milliseconds",
      "required": false
    },
    {
      "id": "process.football.metadata",
      "role": "metadata",
      "kind": "metadata",
      "payload": "json",
      "timebase": "milliseconds",
      "required": false
    }
  ],

  // Named bundles help sinks choose correct groups without hardcoding every track id.
  "bundles": [
    {
      "id": "canonical-live",
      "tracks": ["publish.video.rendered", "publish.audio.raw"]
    },
    {
      "id": "debug-json",
      "tracks": ["process.football.metadata"]
    }
  ]
}
```

A local preview sink might subscribe to `primary-video`. A debug file sink might subscribe to metadata. A simulcast sink might require the `canonical-live` bundle. Each sink should declare:

- accepted track kinds
- required roles
- whether it can handle discontinuity markers
- whether it needs keyframes on resume
- finalize behavior and timeout

Shutdown is complete only when the worker sees EOS or stop intent, allowed tracks are drained, and required sinks have finalized or timed out according to control policy.

## Pause And Timeline Continuity

Pause stops source/media advancement and preserves worker state. It is driven by `system:pause.settings.requested`. Visual presentation while paused is configured separately via `whilePaused` (`hold` or `slate`) and optional `slateAssetId`.

When pause is requested:

```text
1. Board.system.pause.requested becomes true.
2. Board revision increments and wakes the worker.
3. Supervisor reads the new snapshot.
4. Supervisor promotes running -> pausing, appends pause-start (and presentation-slate when configured).
5. Supervisor pauses live sources (stop producing) or gates pull for file sources.
6. Supervisor enters paused immediately in the same turn — no sink catch-up, no ordinary media delivery during pausing.
7. Worker retains cursors, queued media, and stage state until resume.
```

Pause markers may remain queued in the track until resume, stop, or natural sink drain. Board status becomes `paused` without waiting for sinks to receive pause markers.

Presentation changes while pause is active (`requested === true`) are rejected for now.

Resume appends `pause-end` and restores source production. Interrupt, reset, seek, and discontinuity are separate operations — not encoded in pause settings.

| Removed vocabulary (not in Board pause) | Former meaning |
| --- | --- |
| `pause.mode` | Source drain / epoch interrupt modes |
| `pause.fill` / `gap` / `stop` | Former fill policy during pause (removed) |
| `markDiscontinuity` | Resume discontinuity marker |
| `capture:browser.settings.livePause` | Per-source pause policy |
| `system:memory:setBudget` | Unenforced memory knob |
| `tick.targetIntervalMs` etc. | Scheduler internals |

## Prepare Order

Prepare must create the graph before anything pumps. Avoid partial first snapshots where UI thinks a run is ready while sinks or tracks are missing.

Full order:

```text
1. Create the initial Board and ControlBus.
2. Validate run config and command grants.
3. Resolve capture descriptor and validate capture config.
4. Resolve process descriptor and validate process config, unless passthrough.
5. Resolve publish descriptor and validate publish config.
6. Create capture stage resources.
7. Declare source track roles from capture: video, audio, metadata, markers.
8. Create process stage resources.
9. Declare derived track roles from process: rendered inputs, metadata, overlays, markers.
10. Build publish manifest from source tracks, process tracks, publish config, and sink needs.
11. Attach sinks and validate each sink against the manifest.
12. Create empty WorkerState: tracks, cursors, budgets, epochs, storage, stage handles.
13. Mark control status as prepared.
14. On start, fork the worker and begin supervisor turns.
```

Simulated file replay example:

```text
1. Run config asks for:
   capture:file input.mp4
   process:football
   publish:local with debug-file sink

2. Prepare validates:
   file exists
   football process config is valid
   local preview can consume primary video
   debug-file can consume metadata

3. Prepare declares source roles:
   capture.video.raw
   capture.audio.raw if present
   capture.timeline.markers

4. Process declares possible derived roles:
   process.football.metadata
   publish.video.rendered

5. Publish manifest declares:
   canonical-live = publish.video.rendered + optional publish.audio.raw
   debug-json = process.football.metadata

6. Worker state is created empty:
   tracks exist, cursors exist, budgets exist, no media has moved.

7. Start forks worker:
   first supervisor turn reads control revision,
   pumps capture,
   then process,
   then publish/sinks when ranges are available.
```

Prepare may fail. If it does, close any resources already opened and return a concrete reason. Do not leave a half-live worker.

## Settings Exposed By This Architecture

The settings below should exist as control-plane data. The worker enforces them, but it does not decide product intent.

```jsonc
{
  // Pause and presentation (Board system:pause.settings).
  "pause.requested": "Whether pause is requested.",
  "pause.whilePaused": "hold or slate presentation while paused.",
  "pause.slateAssetId": "Static image asset when whilePaused is slate.",

  // Memory and pressure (future — not on Board until enforced).
  "memory.residentBudgetBytes": "Total resident worker budget.",
  "memory.highWatermarkRatio": "Pressure begins here.",
  "memory.lowWatermarkRatio": "Pressure relief target.",
  "memory.spillEnabled": "Allow cold ranges to move to storage.",
  "memory.spillDirectory": "Storage location for spill files.",
  "memory.overflowPolicy": "Global fallback when memory is exhausted.",

  // Per-track behavior.
  "tracks.*.maxResidentBytes": "Track-specific resident cap.",
  "tracks.*.maxOldestAgeMs": "Maximum tolerated lag for oldest unconsumed item.",
  "tracks.*.spillable": "Whether this track can be written to storage.",
  "tracks.*.overflowPolicy": "Block, spill, drop, or fail for this track.",

  // Capture.
  "capture.targetFps": "Desired capture/sample rate.",
  "capture.crop": "Desired source crop or viewport.",
  "capture.runAhead": "Whether capture may keep reading while downstream is held.",
  "capture.maxPumpMs": "Capture work budget per turn.",

  // Process.
  "process.pull.kind": "one, batch, window, or sampled.",
  "process.pull.batchSize": "Batch size when kind is batch.",
  "process.pull.allowPartialAtEos": "Flush partial ranges at end of stream.",
  "process.pull.windowMs": "Time window when kind is window.",
  "process.pull.sampleEvery": "Sampling interval when kind is sampled.",
  "process.maxCallMs": "Timeout for one process call.",
  "process.stallMs": "No-output threshold before degraded/restart.",
  "process.failurePolicy": "Restart, pause, skip, or fail.",
  "process.newEpochOnRestart": "Mark outputs after restart as a new epoch.",

  // Publish and sinks.
  "publish.layoutFixedAfterPrepare": "Whether manifest can change mid-run.",
  "publish.canonicalMode": "Bundle or muxed output model.",
  "publish.finalizeTimeoutMs": "How long to wait for sink flush.",
  "sinks.*.subscribe": "Manifest tracks or bundles consumed by a sink.",
  "sinks.*.required": "Whether sink failure fails or degrades the run.",
  "sinks.*.maxLatencyMs": "How far behind a sink may fall.",

  // Seek and epochs.
  "seek.pendingMediaTimeMs": "Requested seek target.",
  "seek.newEpochOnSeek": "Whether seek creates a new continuity span.",
  "seek.trackBehavior": "Clear or retain marked previous ranges.",

  // Diagnostics.
  "diagnostics.verboseSnapshots": "Expose deep track and cursor facts.",
  "diagnostics.traceSupervisor": "Log supervisor decisions."
}
```

Keep this compact in runtime snapshots. Operators need the important facts, not every internal field every tick.

## Memory, Spill, And Rehydrate

Pressure is not mystical backpressure. Pressure is measurable worker state:

- resident bytes
- pinned bytes
- spilled bytes
- item count
- oldest unconsumed age
- producer rate
- consumer rate
- cursor lag
- sink lag

When pressure rises, the supervisor should act in this order:

```text
1. Release ranges consumed by all cursors.
2. Avoid new capture reads if source can be held.
3. Spill eligible cold ordered ranges if spill is enabled.
4. Drop stale ranges only when the track policy allows it.
5. Block producers if correctness requires retaining data.
6. Fail the run with a clear resource reason if no policy can satisfy the state.
```

When pressure falls, the supervisor may rehydrate from storage. Rehydrate must merge by track id, epoch, sequence, and media time. It must not merge by arrival time. New capture frames may append at the tail while an older range rehydrates, but consumers should only receive contiguous ranges that match their cursor policy.

Inflight ranges are pinned. Storage cleanup must not delete a range claimed by process or sink work.

## Cooperative Tick Vs Per-Stage Fibers

Start with cooperative tick.

Cooperative tick means the supervisor owns shared-state mutation. On each turn it decides which pump runs and commits results in order. This is simpler to reason about, easier to test, and enough for the first working architecture.

Per-stage fibers means capture, process, publish, or sinks run as separate tasks and coordinate through worker-owned state. This may be needed later for browser capture, Python CV, or network sinks, but it should not change ownership. Even with per-stage fibers, shared media state must still be committed through worker-owned functions.

Good upgrade path:

```text
cooperative worker turn
  -> async work behind a pump boundary
  -> stage-local fiber for slow I/O
  -> worker-owned commit of results
```

Bad upgrade path:

```text
stage fiber owns its own queue
  -> process reads capture private queue
  -> publish reads process private queue
  -> supervisor learns about problems after the fact
```

## Domain Data

Do not create a major architecture split called observation schema versus bridge panel data in this package right now. Process outputs are data-plane payloads. Bridge panel data is operator-facing settings, functions, status, refs, and reasons projected from the Board and Catalog.

Football or any other process pack may emit metadata on a worker track. UI controls should not depend on that domain payload shape unless a separate projection explicitly chooses to display it. A process restart, seek, or pause can create a new epoch so downstream consumers can ignore stale payloads.

## What Good Code Looks Like

Good code keeps ownership obvious:

- `run/control/board/model.ts` defines the board document and pure update helpers.
- `run/control/bus/` defines surfaces, functions, subscriptions, artifacts, and bus execution.
- `run/control/board/settings.ts` defines defaults and validation for settings.
- `run/kernel.ts` performs lifecycle transitions and owns the worker handle.
- `run/worker/worker.ts` starts and stops the worker loop.
- `run/worker/state.ts` owns track/cursor/range mutation helpers.
- `run/worker/supervisor.ts` decides what the worker should do next.
- `run/worker/pumps.ts` calls capture/process/publish stage implementations.
- Future `run/worker/storage.ts` or equivalent storage boundary handles spill files and rehydration when spill is implemented.
- `run/worker/snapshot.ts` projects worker facts.
- `bridge/panel/project.ts` builds bridge panel snapshots from the Board plus optional Catalog metadata. Worker facts must reach panel only after worker snapshot projection writes readonly/status facts onto the Board.
- `scope/` owns observe-internal authorization: `CapabilityScope` grammar, capability grants, exact/prefix/global scope matching, and command allow/deny before board mutation. External gateway authenticates; observe scope authorizes.
- `pipeline/*` declares stage capability scopes in descriptors but imports the scope grammar from `scope/`. Pipeline remains stage descriptors, validation, and stage implementation.

Good code follows these rules:

- Board policy is data.
- Worker state is factual runtime state.
- Stage code does stage work only.
- Cursors commit only after successful work.
- Markers are ordered timeline items.
- Sinks validate against a manifest before start.
- Shutdown waits for drain plus sink finalize, or a policy timeout.
- All resourceful functions return Effect blueprints.
- Only edge code, tests, or host runs Effects.

## What Should Not Be Built

Do not build a `pipeline/track/` package for this architecture. Tracks are worker state.

Do not let capture, process, publish, or sinks create private shared queues.

Do not make pause a single boolean that only sleeps a loop.

Do not let sinks infer track layout by inspecting the first payload.

Do not change publish layout mid-run unless a later version explicitly designs dynamic manifest revisions.

Do not expose raw worker state directly to UI or bridge.

Do not make the worker react to every control field through direct subscriptions. Wake on changes, then read one snapshot per turn.

Do not model every frame movement as a giant state machine. Use state machines for run and worker lifecycle. Use ordered ranges, cursors, and markers for media movement.

Do not call `Effect.run*` in observe library code.

Do not keep old vocabulary in new files. Replace frame bus, frame worker, track pipeline, and publish.write with the terms in this doc.

## First Build Slice

The smallest serious implementation is:

```text
1. run/control/board/model.ts
   Board, statuses, section ownership, pure board reducers.

2. run/control/bus/
   Bus, ControlSurface, Function, subscriptions, artifacts, and call routing.

3. run/control/board/settings.ts
   defaults and validation for memory, pause, process, publish, sinks.

4. run/worker/state.ts
   WorkerState, tracks, cursors, markers, ranges, manifest.

5. run/worker/supervisor.ts
   one cooperative supervisor turn over fake stage handles.

6. run/worker/worker.ts
   start/stop Effect blueprint and turn loop.

7. run/worker/snapshot.ts
   worker facts projected into health/debug shape.

8. run/kernel.ts
   prepare/start/pause/resume/stop wired to board revisions and worker handle.

9. bridge/panel/project.ts
   bridge panel projection from Board plus optional Catalog metadata.
```

After that, wire real capture, process, and publish through `run/worker/pumps.ts`.

The goal is not to build an abstract media framework. The goal is a run-owned worker that makes media movement visible, ordered, controllable, and safe under pressure.

## Phased Delivery

The Board, worker state, manifest, pause, memory, and seek examples in this document describe the **target vocabulary and end-state shape**. They are not a checklist for the first end-to-end run.

Implementation should expose **defaults for the current phase** and **reject unsupported modes with a clear error**. Do not silently accept settings the current phase cannot honor. For example, if spill is not implemented yet, `memory.spillEnabled: true` must fail validation rather than being ignored.

### Slice 4A — worker loop proof (complete)

4A is **complete**. It proves ownership and lifecycle before real file I/O:

```text
prepareCapture returns full FrameSource inside one run scope
CaptureFramePull consumes frames without Stream.drop re-subscribe
synthetic CaptureDriver (test/dev injected, not builtins)
  -> capture pump appends capture.video.raw
  -> process: null passthrough
  -> manifest aliases capture.video.raw as publish.video.rendered
  -> in-memory test sink consumes via SinkAttachment.deliver
  -> EOS marker
  -> supervisor drains
  -> sink finalizes
  -> worker reaches stopped
WorkerSnapshot.capture projects descriptorId, sourceType, exhausted, eosAppended, health
validateWorkerPrepare rejects unknown manifest subscriptions before the loop starts
WorkerRunResult.outcome distinguishes stopped, failed, and max-turns-exceeded
```

4A is strict: no spill, no real file output, no audio, no local preview, no football, no per-stage fibers.

Control state for 4A is a deliberate subset: `revision`, `runId`, `status`, `statusReason`, `tick`, `pause`, `capture`, `process`, `publish`, `sinks`, and minimal `memory` (`residentBudgetBytes`, `overflowPolicy`). The full JSONC example above remains the target vocabulary.

Capture health is refreshed once per supervisor turn through `completeSupervisorTurn`. That is fine for synthetic and early file work. If file/ffmpeg health reads become expensive or blocking in 4B, throttle refresh or make health event-driven rather than polling every turn.

### Slice 4B — file passthrough export (complete)

4B is **complete**. It adds the first real media path and thin public lifecycle:

```text
adapters/ffmpeg/ shared probe, process, and byte helpers
capture/file replay-only driver (rgb payloads, sourceId capture:file)
publish/encoder/mp4.ts rgb24 -> libx264/yuv420p MP4
publish/sinks/file driver (lazy encoder init, fail if output exists)
builtins.ts registry metadata + getBuiltInCaptureDriver/getBuiltInSinkDriver
makeObserveRun / prepareObserveRun / startObserveRun thin kernel
acceptance: file -> passthrough -> MP4 artifact via startObserveRun
capture health read failure fails worker during supervisor turn
```

Builtins register **file capture**, **browser capture (descriptor only)**, and **file sink**. Synthetic remains test/dev injected. Browser driver implementation requires adapter injection via `createBrowserCaptureDriver(adapter)`.

Driver resolution stays outside registry entries:

```text
builtInObserveRegistry                 // descriptors/discovery
getBuiltInCaptureDriver("file")        // file implementation
createBrowserCaptureDriver(adapter)    // browser implementation (adapter required)
getBuiltInSinkDriver("file")           // file sink implementation
```

### Slice 4C — browser capture (complete)

4C adds browser capture as a normal capture driver and proves jpeg/png payloads through the media worker into MP4 export:

```text
pipeline/capture/browser/
  page/
    types.ts           injected browser/page boundary types
    adapter.ts         Playwright/Puppeteer/CDP page normalization
    target-detection.ts
  control/
    controls.ts        source-local runtime controls (setCrop, setCaptureFps)
  driver.ts            CaptureDriver id "browser", sourceType "browser"
  index.ts             re-exports only
publish/encoder/mp4.ts
  createMp4VideoEncoder selects rgb vs jpeg/png image2pipe paths
publish/sinks/file
  chooses encoder path from payload byteFormat; no jpeg/png special cases in sink logic
kernel ObserveRunKernelOptions.captureDriver
  injects browser driver for prepare/start without faking worker internals
acceptance: browser (fake adapter, valid jpeg bytes) -> passthrough -> MP4 artifact
```

Browser capture is **not** a worker special case. It implements the same `CaptureDriver -> FrameSource -> RawFrame -> CaptureVideoPayload` contract as file capture.

Adapter injection is required. Observe core does not depend on Playwright or Puppeteer. Host/CLI wiring lands in a later slice; the adapter seam is the contract.

Browser frames carry `byteFormat`/`encoding` of `jpeg` or `png`. The file sink delegates to `createMp4VideoEncoder`, which uses ffmpeg `image2pipe` for those formats.

Source-local controls expose `setCrop`, `clearCrop`, `setCaptureFps`, and preview helpers through `FrameSource.control` (browser `BrowserCaptureControls` behind the surface). Bus function scopes use `capture:browser:*` (for example `capture:browser:setCrop`, `capture:browser:inspectTargets`). Functions route through `ControlBus.callFunction` after prepare mounts the browser surface cell and start mounts live handlers.

Optional `maxFrames` bounds capture for acceptance tests and finite clips. Live browser capture omits it for a continuous stream until the worker stops the source.

IPTV/stream capture belongs under `pipeline/capture/iptv/` in a future slice, not under `browser/`.

### Slice 4D — control-plane preview artifacts (complete)

4D adds the first rich **control artifact** lane and browser preview-first human controls without regressing 4C media capture.

```text
pipeline/capture/browser/
  control/
    preview.ts
    preview-encoding.ts
    payloads.ts
    controls.ts
    surface.ts
  page/
    types.ts
    target-detection.ts
    adapter.ts
  driver.ts
  index.ts
run/control/
  bus/
    calls.ts
    bus.ts
    types.ts
    index.ts
    subscriptions.ts
    artifacts.ts
    registry.ts
  board/
    patch.ts
  system/
    pause.ts
    run.ts
```

Preview transport:

```text
Bridge -> ControlCallEnvelope(scope: capture:browser:inspectTargets)
  -> Bus calls Function on capture:browser ControlSurface
  -> ControlCallResult.artifact.kind = browser.previewTargets
  -> Bridge returns ControlCallResult with artifactId and, for immediate command response, inline artifact JSON containing preview.dataUri + numbered browser targets[]
```

Rules:

- Preview images live in `ControlCallResult.artifact`, not in the Board and not in worker tracks.
- Function payload decoding must fail with `LiveStreakConfigError`, never throw `TypeError`.
- Read-only preview functions do not bump board revision; they advance browser-local `previewRevision`.
- Mutating functions return explicit board patches.
- `getPreview` and `inspectTargets` share artifact kind `browser.previewTargets`; `getPreview` returns `targets: []`.
- Browser cadence fix: first frame does not count startup drift as dropped; frame 0 media/source time starts at 0.

### Slice 4E — control bus (current)

Each prepared observe run owns a `ControlBus`:

```text
ControlBus per ObserveRun
Board as the shared section-owned state surface
ControlSurface per running stage attachment
Function table for callable control operations
Subscription API for in-memory board/artifact events
Artifact store/result lane for inline bytes or references
Catalog function metadata with generic input/output shapes
Stage-owned `describeControl` for Board cell shape; live handlers mount at start
expanded pause schema for live sources (behavior still incomplete)
ESLint guard: pipeline/** may import only #run/control/bus/calls.js and #run/control/bus/types.js
```

`createControlBus({ runId, ... })` returns `Effect<ControlBus, LiveStreakConfigError>`. Each bus rejects mismatched `callFunction` envelopes. Duplicate live surface scopes fail at construction or `mountSurface` with typed config errors. Unknown capture drivers fail at prepare with `LiveStreakConfigError`.

Surface mount semantics:

- `mountSurface` always updates or replaces live function handlers in the surface registry, even when visible Board metadata is unchanged.
- Board revision increments only when the mount inserts a missing cell or changes structural cell metadata (`label`, `catalog`, `functions`). Existing `settings`, `readonly`, `refs`, and `status` are preserved on remount.
- Board subscribers are notified only when a mount changes visible Board metadata.
- Initial `surfaces` passed to `createControlBus` are merged into the starting Board with the same cell merge rules. No subscriber notifications fire during construction.

Live external dispatch through Bridge/Runtime and commanded stop are implemented. Transport gateways and richer sink/host artifacts remain future work.

### v0 — first end-to-end run (Slice 4B complete)

This is the smallest **real** runtime with an inspectable artifact:

```text
cooperative worker turn loop
one video track role (capture.video.raw → publish.video.rendered via manifest alias)
file capture source
process: null passthrough first; football may follow immediately after
one real file sink
manifest built at prepare; layout fixed after prepare
overflow: block-producer or fail-run only (no spill, no drop-stale tuning)
pause: requested boolean + hold/slate presentation
no spill, no seek, no audio, no dynamic manifest changes
process: cooperative tick; external work may start async and commit on a later turn
```

Passthrough runs use `process: null`. Publish declares `publish.video.rendered` as a manifest alias to `capture.video.raw` without copying into a second track bucket.

Acceptance run: `file -> passthrough -> file export`.

Validation must reject unsupported v0 settings explicitly, including but not limited to:

- `memory.spillEnabled: true`
- `memory.overflowPolicy: spill-cold` or `drop-stale` when spill is unavailable
- legacy pause fields (`mode`, `fill`, `markDiscontinuity`) or `capture:browser.settings.livePause`
- `seek.pendingMediaTimeMs` set to any value
- audio sink subscriptions or audio track roles
- `publish.canonicalMode: muxed`

### v1 — football and richer manifest

```text
process:football on worker tracks
derived metadata track(s) where the pack declares them
manifest bundles (for example canonical-live vs debug-json)
real capture/process/publish pumps through run/worker/pumps.ts
interrupt/reset/seek/discontinuity as separate operations when added
```

### v2 — pressure, timeline, and host output

```text
audio tracks and multi-sink layouts
seek commands and epoch behavior
spill / rehydrate through a future worker storage boundary
simulcast sink finalize timeouts
per-track spill and drop policies beyond block/fail
async stage fibers behind pump boundaries where browser or Python demand it
```

When a feature is documented above but not built in the current phase, keep the types and settings in the doc examples so the vocabulary stays stable. Gate behavior in `run/control/board/settings.ts` and document the phase in error messages.

## Market registration (observe → bookmaker boundary)

Observe owns the **video stream**; that stream is the **market container**. Bookmaker does **not** create markets. In the contract model, a market is created by the observer/video stream, and vaults are created under that market.

```text
Observe run starts
  -> endpoint manifest / WebRTC / watch URL / evidence refs exist
  -> observer registers market on-chain or via explicit contract write at the edge
  -> marketId references observeRunId, manifest URI, subjectRef, observer

Host:
  -> indexes active markets, manifests, watch URLs, evidence refs, and vault metadata
  -> helps discovery and duplicate/similarity lookup
  -> does not create the market or decide market truth

Bookmaker later:
  -> watches the direct WebRTC/watch URL and/or observation channel for that marketId
  -> queries existing vaults under the same marketId
  -> creates or joins vaults under marketId only
```

Observe responsibilities for this boundary (target slices):

- Publish endpoint manifest and evidence refs needed for market registration.
- Expose `observeRunId`, manifest URI, watch URL/WebRTC endpoint refs, and subject metadata to gateway/bookmaker (via bridge read models or host session — transport TBD).
- Trigger or coordinate **market registration write** at stream start through edge orchestration. This may live in CLI/gateway calling `@livestreak/contracts`; it must not become hidden worker logic inside the observe kernel.

Observe does **not**:

- Create vaults or prediction pools (bookmaker).
- Run bookmaker strategy or similarity (bookmaker + host).
- Stream user funds into vaults (options).
- Judge bad markets, bad vaults, bad bookmakers, or bad stewards (steward).

Similarity is **vault-scoped inside `marketId`**, not global topic collapse across unrelated streams. Host may suggest similar vaults under the active market, but the bookmaker chooses an explicit action: join existing vault, create a new vault under the same market, or do nothing. See `packages/bookmaker/docs/architecture.md`.

## Relationship To Existing Instructions

This file is the **source of truth for observe runtime architecture**: control plane vs media worker, folder layout under `run/control/` and `run/worker/`, supervisor turns, manifest ownership, pause policy, and bridge projection rules.

Other instructions still apply where they do not conflict:

| Document | Role |
| --- | --- |
| `docs/architecture.md` (this file) | Runtime model, ownership boundaries, phased delivery |
| `packages/bookmaker/docs/architecture.md` | Vault creation under observer-registered markets |
| `AGENTS.md` (when present) | Package style: exports at top, helpers at bottom, Effect purity, dependency order between pipeline / run / scope / bridge |
| `README.md` (when present) | Slice ordering; should be updated to follow the **First Build Slice** and **Phased Delivery** sections here instead of porting `-re` kernel verbatim |

If `AGENTS.md` or `README.md` still describe only `run/kernel.ts` without `run/control/` and `run/worker/`, treat this document as authoritative for run layout until those files are updated to point here.

### How the layers fit together

```text
pipeline/* stage implementations
  -> media worker supervisor turn
  -> WorkerSnapshot (health facts, not raw worker state)
  -> run/control/board/worker-snapshot.ts projects facts onto Board
  -> bridge/panel/project.ts projects Board + optional Catalog metadata
  -> Bridge returns Board, Panel, call results, subscriptions, or Artifacts
```

`scope/` gates Bridge calls before runtime or bus work. Pipeline descriptors feed Catalog metadata; pipeline stage implementations do not call Bridge or own authorization.

The Board holds shared operator intent, policy, settings, and readonly surface facts. `WorkerSnapshot` holds factual runtime health until projection. `bridge/panel/project.ts` reads Board and optional Catalog metadata only.

Bridge transport ships a **projected panel**, not raw worker state. Include enough Board-projected health facts to debug a live run: status, track depth, oldest item age, resident bytes, spill bytes (when implemented), sink lag, and last error.

### Relationship to `-re`

`-re` (`packages-re/sdk-stats`) is a quarry, not a layout template. Useful to port: ffmpeg decode ingress, stage descriptors, registry pattern, football pack logic, encode egress patterns. Do not port: top-level `visual/`, monolithic session kernel ownership, private stage queues, `schema/observation.ts` as a shared UI contract, or `control-surface` transport/UI tone.

When porting a file, rearrange it into the folder shape in this document and drop behavior that violates ownership rules here.

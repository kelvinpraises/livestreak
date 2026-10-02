import { describe, expect, it } from "vitest";
import { Effect, Fiber, Stream } from "effect";
import type { FunctionDescriptor } from "@livestreak/schema";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus, type ControlBus, type ControlPanel } from "#run/control/bus/index.js";
import { createInitialBoard, type Board } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectControlPanelControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigCaptureKindScope,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { ingestCaptureConfigureScope } from "#pipeline/capture/ingest/commands.js";
import { createIngestCaptureDriver } from "#pipeline/capture/ingest/driver.js";
import { runConfigFromBoard } from "#run/board-run-config.js";

// Own range: ingest-capture.test.ts binds 48719-48725 in parallel workers.
const PORT = 48741;
const W = 16;
const H = 16;

const makeBus = (runId: string) =>
  createControlBus({
    runId,
    board: createInitialBoard({ runId, nowMs: 1 }),
    catalog: buildControlCatalog(),
    surfaces: createObserveControlSurfaces({})
  });

const fieldNames = (descriptor: FunctionDescriptor | undefined): readonly string[] =>
  (descriptor?.inputSchema?.type === "object" ? descriptor.inputSchema.properties ?? [] : []).map(
    (property) => property.name
  );

const frame = (fill: number): Uint8Array<ArrayBuffer> => {
  const data = new Uint8Array(W * H * 4);
  data.fill(fill);
  return data;
};

describe("ingest capture — client configure to POST proof", () => {
  // Overlay the market/publish prerequisites derivation needs (register + publish-kind
  // belong to other verbs; this proof owns only the capture path).
  const withMarket = (board: Board, obsId: string): Board => ({
    ...board,
    cells: {
      ...board.cells,
      [observationCellId(obsId, "market")]: {
        ...board.cells[observationCellId(obsId, "market")]!,
        readonly: {
          ...board.cells[observationCellId(obsId, "market")]?.readonly,
          marketId: "market-bot"
        }
      },
      [observationCellId(obsId, "publish")]: {
        ...board.cells[observationCellId(obsId, "publish")]!,
        readonly: {
          ...board.cells[observationCellId(obsId, "publish")]?.readonly,
          kind: "live",
          // Completed publish prerequisite (mirrors a configured sink; this proof owns
          // only the capture path, so the sink configure step is overlaid, not performed).
          configured: true
        }
      }
    }
  });

  it("an outside role client discovers captureKind, selects ingest, configures, POSTs", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_ingest_e2c";
          const bus: ControlBus = yield* makeBus(runId);

          // Add observation (title + chain only — the only T0 input).
          yield* bus.callFunction({
            callId: "add-1",
            runId,
            scope: systemConfigConfigureScope,
            payload: { title: "bot show", chain: "eip155:31337" }
          });
          let board: Board = yield* bus.readBoard();
          const obsId = Object.keys(readObservationIndex(board))[0]!;

          // B3-R01: the switch is DISCOVERED from a real projected panel — never scope-direct.
          // An outside client reading descriptors must find it with its obsId/kind fields.
          const prePanel: ControlPanel = {
            board,
            catalog: yield* bus.readCatalog()
          };
          const preDescriptors = projectObserveDescriptors(
            projectControlPanelControls(prePanel),
            board
          );
          const kindSwitch = preDescriptors.find((d) => d.id === "observe.system.config.captureKind");
          expect(kindSwitch?.visible).toBe(true);
          expect(fieldNames(kindSwitch)).toEqual(expect.arrayContaining(["obsId", "kind"]));

          // Flip the family capture kind through the public switch (rejects unknown kinds).
          yield* bus.callFunction({
            callId: "kind-1",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.catalog).toBe("capture:ingest");
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            source: "ingest"
          });

          // B4-R01: switch → derive rejects until destination configure lands.
          const denied = yield* runConfigFromBoard({
            runId,
            board: withMarket(board, obsId),
            hostBaseUrl: "http://127.0.0.1:8787"
          }).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll((e) => Effect.succeed(e.message))
          );
          expect(denied).toContain("Configure capture");

          // The console now renders the bot's contract fields for this cell.
          const panel: ControlPanel = { board, catalog: yield* bus.readCatalog() };
          const descriptors = projectObserveDescriptors(projectControlPanelControls(panel), board);
          const captureConfigure = descriptors.find(
            (d) => d.id === `observe.obs.${obsId}.capture.configure`
          );
          expect(fieldNames(captureConfigure)).toEqual(
            expect.arrayContaining(["width", "height", "fps"])
          );

          // Configure the contract through the same public path (missing dims fail closed).
          const bad = yield* Effect.exit(
            bus.callFunction({
              callId: "cap-bad",
              runId,
              scope: ingestCaptureConfigureScope,
              cellId: observationCellId(obsId, "capture"),
              payload: { width: 0, height: H, fps: 30 }
            })
          );
          expect(bad._tag).toBe("Failure");
          // G14-B05: unsafe dimensions never reach the board.
          const unsafe = yield* Effect.exit(
            bus.callFunction({
              callId: "cap-unsafe",
              runId,
              scope: ingestCaptureConfigureScope,
              cellId: observationCellId(obsId, "capture"),
              payload: { width: 2 ** 1023, height: H, fps: 30 }
            })
          );
          expect(unsafe._tag).toBe("Failure");
          // G18-B03: safe even operands with an unsafe PRODUCT fail for both formats AND
          // leave the board untouched (decode fails before any patch is built).
          for (const byteFormat of ["rgba", "yuv420p"] as const) {
            const product = yield* Effect.exit(
              bus.callFunction({
                callId: `cap-product-${byteFormat}`,
                runId,
                scope: ingestCaptureConfigureScope,
                cellId: observationCellId(obsId, "capture"),
                payload: { width: 2 ** 52, height: 2 ** 52, fps: 30, byteFormat }
              })
            );
            expect(product._tag, byteFormat).toBe("Failure");
          }
          // Failed configures build no patch: only the kind switch's source stamp remains
          // (maxPumpMs was already cleared by that switch); no width/height/fps leaked in.
          expect(
            (yield* bus.readBoard()).cells[observationCellId(obsId, "capture")]?.settings
          ).toEqual({ source: "ingest" });

          yield* bus.callFunction({
            callId: "cap-1",
            runId,
            scope: ingestCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { width: W, height: H, fps: 30, port: PORT }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            source: "ingest",
            width: W,
            height: H,
            fps: 30,
            port: PORT,
            // Omitted on configure: the decoder writes the default, never retains.
            byteFormat: "rgba"
          });

          // Q3: an explicit YUV setting is written, then reset by a later omission.
          yield* bus.callFunction({
            callId: "cap-yuv",
            runId,
            scope: ingestCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { width: W, height: H, fps: 30, port: PORT, byteFormat: "yuv420p" }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            byteFormat: "yuv420p"
          });
          yield* bus.callFunction({
            callId: "cap-reset",
            runId,
            scope: ingestCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { width: W, height: H, fps: 30, port: PORT }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            byteFormat: "rgba"
          });

          // The board derives the ingest driver.
          const runConfig = yield* runConfigFromBoard({
            runId,
            board: withMarket(board, obsId),
            hostBaseUrl: "http://127.0.0.1:8787"
          });
          expect(runConfig.capture.driverId).toBe("ingest");

          // And the derived contract serves a real posted frame.
          const driver = createIngestCaptureDriver();
          const source = yield* driver.create(runConfig.capture.config as never);
          const fiber = yield* Effect.fork(
            source.frames.pipe(Stream.take(1), Stream.runCollect)
          );
          const res = yield* Effect.promise(() =>
            fetch(`http://127.0.0.1:${PORT}/frames`, { method: "POST", body: frame(41) })
          );
          expect(res.status).toBe(200);
          const taken = yield* Fiber.join(fiber);
          expect([...taken][0]?.payload.data[0]).toBe(41);

          // B3-R02 reverse leg: ingest → file → configure → derive yields file. The switch
          // stamps source itself AND file's configure re-stamps it, so no stale ingest survives.
          yield* bus.callFunction({
            callId: "kind-2",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "file" }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.catalog).toBe("capture:file");
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            source: "file"
          });
          yield* bus.callFunction({
            callId: "cap-2",
            runId,
            scope: fileCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { path: "/tmp/bot-show.mp4" }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).toMatchObject({
            source: "file",
            path: "/tmp/bot-show.mp4"
          });
          const fileConfig = yield* runConfigFromBoard({
            runId,
            board: withMarket(board, obsId),
            hostBaseUrl: "http://127.0.0.1:8787"
          });
          expect(fileConfig.capture.driverId).toBe("file");
          expect(fileConfig.capture.config).toMatchObject({ path: "/tmp/bot-show.mp4" });

          // B4-R01 reverse rejection: switch back to ingest, derive refuses again.
          yield* bus.callFunction({
            callId: "kind-3",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          board = yield* bus.readBoard();
          const deniedAgain = yield* runConfigFromBoard({
            runId,
            board: withMarket(board, obsId),
            hostBaseUrl: "http://127.0.0.1:8787"
          }).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll((e) => Effect.succeed(e.message))
          );
          expect(deniedAgain).toContain("Configure capture");
        })
      )
    );
  });

  it("configured file → ingest without a path serves the default endpoint", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_ingest_stale_path";
          const bus: ControlBus = yield* makeBus(runId);
          yield* bus.callFunction({
            callId: "add-1",
            runId,
            scope: systemConfigConfigureScope,
            payload: { title: "file show", chain: "eip155:31337" }
          });
          let board: Board = yield* bus.readBoard();
          const obsId = Object.keys(readObservationIndex(board))[0]!;
          // A real configured file source first.
          yield* bus.callFunction({
            callId: "cap-file",
            runId,
            scope: fileCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { path: "/tmp/show.mp4" }
          });
          // The switch wipes the media path (and every other detail key).
          yield* bus.callFunction({
            callId: "kind-1",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          board = yield* bus.readBoard();
          expect(board.cells[observationCellId(obsId, "capture")]?.settings).not.toHaveProperty(
            "path"
          );
          // Bot configures required dims only — no endpoint override.
          yield* bus.callFunction({
            callId: "cap-ingest",
            runId,
            scope: ingestCaptureConfigureScope,
            cellId: observationCellId(obsId, "capture"),
            payload: { width: W, height: H, fps: 30 }
          });
          board = yield* bus.readBoard();
          const runConfig = yield* runConfigFromBoard({
            runId,
            board: withMarket(board, obsId),
            hostBaseUrl: "http://127.0.0.1:8787"
          });
          expect(runConfig.capture.driverId).toBe("ingest");
          // Default port/path (driver fills them): the documented endpoint answers.
          const driver = createIngestCaptureDriver();
          const source = yield* driver.create(runConfig.capture.config as never);
          const fiber = yield* Effect.fork(
            source.frames.pipe(Stream.take(1), Stream.runCollect)
          );
          const res = yield* Effect.promise(() =>
            fetch("http://127.0.0.1:48710/frames", { method: "POST", body: frame(7) })
          );
          expect(res.status).toBe(200);
          const taken = yield* Fiber.join(fiber);
          expect([...taken][0]?.payload.data[0]).toBe(7);
        })
      )
    );
  });
});

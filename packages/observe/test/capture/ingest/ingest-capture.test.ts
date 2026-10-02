import { describe, expect, it } from "vitest";
import { Effect, Fiber, Stream } from "effect";
import { createIngestCaptureDriver } from "#pipeline/capture/ingest/driver.js";

const PORT = 48719;
const W = 16;
const H = 16;
const frame = (fill: number): Uint8Array<ArrayBuffer> => {
  const data = new Uint8Array(W * H * 4);
  data.fill(fill);
  data.forEach((_v, i) => {
    if (i % 4 === 3) data[i] = 255;
  });
  return data;
};

const post = (port: number, body: Uint8Array<ArrayBuffer>) =>
  fetch(`http://127.0.0.1:${port}/frames`, { method: "POST", body });

describe("ingest capture driver", () => {
  it("rejects configs without a bot frame contract", async () => {
    const driver = createIngestCaptureDriver();
    const exit = await Effect.runPromiseExit(
      // @ts-expect-error — the bot contract requires dimensions; the board must carry them
      driver.validate({ port: PORT })
    );

    expect(exit._tag).toBe("Failure");
  });

  it("serves a bot's arbitrary rendered frames as advancing RawFrames", async () => {
    const driver = createIngestCaptureDriver();
    const frames = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* driver.create({
            port: PORT,
            width: W,
            height: H,
            fps: 30
          });
          const fiber = yield* Effect.fork(
            source.frames.pipe(
              Stream.take(3),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk])
            )
          );
          for (const fill of [11, 22, 33]) {
            const res = yield* Effect.promise(() => post(PORT, frame(fill)));
            expect(res.status).toBe(200);
          }
          return yield* Fiber.join(fiber);
        })
      )
    );

    expect(frames.map((f) => f.id)).toEqual([
      "capture:ingest:0",
      "capture:ingest:1",
      "capture:ingest:2"
    ]);
    expect(frames[0]?.payload.data[0]).toBe(11);
    expect(frames[2]?.payload.data[0]).toBe(33);
    expect(frames[2]?.payload.byteFormat).toBe("rgba");
  });

  it("rejects wrong-sized bodies instead of emitting corrupt frames", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* driver.create({ port: PORT + 1, width: W, height: H, fps: 30 });
          const res = yield* Effect.promise(() => post(PORT + 1, new Uint8Array(10)));
          expect(res.status).toBe(400);
        })
      )
    );
  });

  it("a full queue answers 429 through the real endpoint instead of hanging the POST", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // maxQueuedFrames: 1 and NO consumer yet: the first POST buffers, the second must
          // be rejected synchronously — Queue.offer would park it until a take frees space.
          const source = yield* driver.create({
            port: PORT + 2,
            width: W,
            height: H,
            fps: 30,
            maxQueuedFrames: 1
          });
          const first = yield* Effect.promise(() => post(PORT + 2, frame(77)));
          expect(first.status).toBe(200);
          const second = yield* Effect.promise(() => post(PORT + 2, frame(88)));
          expect(second.status).toBe(429);
          expect(yield* Effect.promise(() => second.json())).toMatchObject({
            error: expect.stringContaining("slow down")
          });
          // The buffered frame is intact and consumable afterwards.
          const taken = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);
          expect([...taken][0]?.payload.data[0]).toBe(77);
          const health = yield* source.health;
          expect(health.droppedFrames).toBe(1);
        })
      )
    );
  });

  it("rejects odd dimensions that have no valid I420 layout", async () => {
    const driver = createIngestCaptureDriver();
    const exit = await Effect.runPromiseExit(
      driver.validate({ port: PORT + 3, width: 15, height: H, fps: 30 })
    );

    expect(exit._tag).toBe("Failure");
  });

  it("rejects unsafe numbers that would overflow exact byte arithmetic", async () => {
    // G14-B05: 2**1023 is an even positive integer but computes an Infinity body bound;
    // 2**53 overflows queue capacity. No new memory cap — just exact arithmetic.
    const driver = createIngestCaptureDriver();
    for (const config of [
      { port: PORT + 3, width: 2 ** 1023, height: H, fps: 30 },
      { port: PORT + 3, width: 2 ** 53, height: H, fps: 30 },
      { port: PORT + 3, width: W, height: H, fps: 30, maxQueuedFrames: 2 ** 53 }
    ]) {
      const exit = await Effect.runPromiseExit(driver.validate(config));
      expect(exit._tag).toBe("Failure");
    }
  });

  it("rejects safe operands with an unsafe byte product, both formats", async () => {
    // G18-B03: 2**52 is safe and even per side, but 2**52 x 2**52 overflows RGBA and I420
    // byte counts alike. Rejection happens before acquisition/listening.
    const driver = createIngestCaptureDriver();
    for (const byteFormat of ["rgba", "yuv420p"] as const) {
      const exit = await Effect.runPromiseExit(
        driver.validate({ port: PORT + 3, width: 2 ** 52, height: 2 ** 52, fps: 30, byteFormat })
      );
      expect(exit._tag, byteFormat).toBe("Failure");
    }
  });

  it("pause refuses POSTs with 429 paused, idempotent controls keep revision", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* driver.create({
            port: PORT + 4,
            width: W,
            height: H,
            fps: 30
          });
          expect(source.live).toBeDefined();
          const first = yield* source.live!.pause();
          expect(first).toMatchObject({ paused: true, revision: 1 });
          // Idempotent: a second pause without a transition changes nothing.
          expect(yield* source.live!.pause()).toMatchObject({ paused: true, revision: 1 });
          expect(yield* source.live!.snapshot).toMatchObject({ paused: true, revision: 1 });

          const refused = yield* Effect.promise(() => post(PORT + 4, frame(5)));
          expect(refused.status).toBe(429);
          expect(yield* Effect.promise(() => refused.json())).toMatchObject({
            error: "ingest paused",
            reason: "paused"
          });

          const resumed = yield* source.live!.resume();
          expect(resumed).toMatchObject({ paused: false, revision: 2 });
          const accepted = yield* Effect.promise(() => post(PORT + 4, frame(6)));
          expect(accepted.status).toBe(200);
          // Refused frames advance neither sequence nor accepted count.
          expect(yield* Effect.promise(() => accepted.json())).toMatchObject({ seq: 0 });
          const taken = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);
          expect([...taken][0]?.payload.data[0]).toBe(6);
        })
      )
    );
  });

  it("a body completing after pause is refused instead of slipping through", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* driver.create({
            port: PORT + 5,
            width: W,
            height: H,
            fps: 30
          });
          const { default: http } = yield* Effect.promise(() => import("node:http"));
          // A completed POST first proves the server receipt path is live.
          const first = yield* Effect.promise(() => post(PORT + 5, frame(8)));
          expect(first.status).toBe(200);
          const pending = Effect.async<import("node:http").IncomingMessage, never>((resume) => {
            const req = http.request(
              { host: "127.0.0.1", port: PORT + 5, path: "/frames", method: "POST" },
              (res) => resume(Effect.succeed(res))
            );
            req.write(frame(9).subarray(0, 100));
            // Pause lands mid-body (first chunk flushed on loopback, then a beat for kernel
            // delivery) and completion afterwards must still refuse. An entry-only paused
            // check at request headers would admit this body and return 200.
            void Effect.runPromise(Effect.sleep(50))
              .then(() => Effect.runPromise(source.live!.pause()))
              .then(() => req.end(frame(9).subarray(100)));
          });
          const res = yield* pending;
          expect(res.statusCode).toBe(429);
          expect(yield* source.live!.snapshot).toMatchObject({ paused: true });
        })
      )
    );
  });

  it("single-item takes free exactly one queue slot (no hidden prefetch buffer)", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // M2-02: fromQueue without maxChunkSize hands a whole backlog in one pull, which
          // capture-pull buffers outside the queue. Single-item chunks keep queue+1 the bound.
          const source = yield* driver.create({
            port: PORT + 6,
            width: W,
            height: H,
            fps: 30,
            maxQueuedFrames: 2
          });
          expect((yield* Effect.promise(() => post(PORT + 6, frame(1)))).status).toBe(200);
          expect((yield* Effect.promise(() => post(PORT + 6, frame(2)))).status).toBe(200);
          expect((yield* Effect.promise(() => post(PORT + 6, frame(3)))).status).toBe(429);
          const one = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);
          expect([...one][0]?.payload.data[0]).toBe(1);
          // Exactly one slot freed: the next POST fits, the one after does not.
          expect((yield* Effect.promise(() => post(PORT + 6, frame(4)))).status).toBe(200);
          expect((yield* Effect.promise(() => post(PORT + 6, frame(5)))).status).toBe(429);
        })
      )
    );
  });

  it("an unfinished upload does not hold source release open (bounded close)", async () => {
    const driver = createIngestCaptureDriver();
    const port = PORT + 7;
    let stuck: import("node:http").ClientRequest | undefined;
    let clientError: unknown;
    const recordUnexpected = (where: string) => (cause: unknown): void => {
      const code = (cause as { code?: unknown }).code;
      // ECONNRESET is the EXPECTED release receipt (server destroyed the socket).
      if (code !== "ECONNRESET") {
        clientError = new Error(`unexpected client error at ${where}: ${String(cause)}`);
      }
    };
    // Independent owned-client watchdog OUTSIDE the awaited Effect: plain JS timer armed
    // before release. On expiry it marks the receipt expired and destroys the client even if
    // runPromise is stuck inside an uninterruptible finalizer. Cleared on every outcome.
    let expired = false;
    const watchdog = setTimeout(() => {
      expired = true;
      stuck?.destroy();
    }, 4000);
    watchdog.unref?.();
    const t0 = Date.now();
    try {
      const closed = await Effect.runPromise(
        Effect.gen(function* () {
          const worker = yield* Effect.fork(
            Effect.scoped(
              Effect.gen(function* () {
                yield* driver.create({ port, width: W, height: H, fps: 30 });
                const { default: http } = yield* Effect.promise(() => import("node:http"));
                // Own the request BEFORE awaiting anything: assign on creation so a connection
                // failure can never orphan it. Then wait until one byte is actually flushed to
                // the kernel (write callback), then leave it open: release must not await the
                // producer finishing the body.
                const req = yield* Effect.promise(
                  () =>
                    new Promise<import("node:http").ClientRequest>((resolve, reject) => {
                      let settled = false;
                      let request: import("node:http").ClientRequest;
                      try {
                        request = http.request(
                          {
                            host: "127.0.0.1",
                            port,
                            path: "/frames",
                            method: "POST",
                            headers: { "content-length": W * H * 4 }
                          },
                          (res) => {
                            res.resume();
                            res.on("error", (cause) => {
                              if (!settled) {
                                settled = true;
                                reject(cause);
                              }
                            });
                          }
                        );
                      } catch (cause) {
                        reject(cause);
                        return;
                      }
                      stuck = request;
                      request.on("error", recordUnexpected("unfinished-upload"));
                      request.write(Buffer.alloc(1), () => {
                        if (!settled) {
                          settled = true;
                          resolve(request);
                        }
                      });
                    })
                );
                void req;
                // Scope ends here: the release must destroy the open connection promptly.
                return true;
              })
            )
          );
          return yield* Fiber.join(worker);
        })
      );

      expect(closed).toBe(true);
      if (clientError !== undefined) throw clientError;
      // The port rebinds immediately: the listener really released.
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* driver.create({ port, width: W, height: H, fps: 30 });
          })
        )
      );
      expect(Date.now() - t0).toBeLessThan(4000);
      // A fired rescue invalidates the receipt even if everything else passed.
      expect(expired).toBe(false);
    } finally {
      clearTimeout(watchdog);
      stuck?.destroy();
    }
  }, 15000);

  it("owned watchdog fires while an await is still blocked and fails the receipt", async () => {
    // Negative harness check: the rescue mechanism itself, independent of any source.
    // A plain JS timer fires while an Effect await is blocked; the expired flag (not the
    // awaited value) classifies the receipt as failed.
    let expired = false;
    const watchdog = setTimeout(() => {
      expired = true;
    }, 100);
    watchdog.unref?.();
    try {
      await Effect.runPromise(
        Effect.never.pipe(
          Effect.timeoutOption(500),
          Effect.map(() => "unreached")
        )
      );
      expect(expired).toBe(true);
    } finally {
      clearTimeout(watchdog);
    }
  }, 15000);

  it("a connected-idle keep-alive does not hold source release open", async () => {
    const driver = createIngestCaptureDriver();
    const port = PORT + 8;
    const agentHolder: { agent?: import("node:http").Agent } = {};
    let expired = false;
    const watchdog = setTimeout(() => {
      expired = true;
      agentHolder.agent?.destroy();
    }, 4000);
    watchdog.unref?.();
    const t0 = Date.now();
    try {
      const done = await Effect.runPromise(
        Effect.gen(function* () {
          const worker = yield* Effect.fork(
            Effect.scoped(
              Effect.gen(function* () {
                yield* driver.create({ port, width: W, height: H, fps: 30 });
                const { default: http } = yield* Effect.promise(() => import("node:http"));
                const agent = new http.Agent({ keepAlive: true });
                agentHolder.agent = agent;
                // Truly idle-connected: response fully consumed, socket parked in the agent.
                const probe = yield* Effect.promise(
                  () =>
                    new Promise<number>((resolve, reject) => {
                      const req = http.request(
                        { host: "127.0.0.1", port, path: "/frames", method: "GET", agent },
                        (res) => {
                          res.resume();
                          res.on("end", () => resolve(res.statusCode ?? 0));
                        }
                      );
                      req.on("error", reject);
                      req.end();
                    })
                );
                expect(probe).toBe(404);
                return true;
              })
            )
          );
          return yield* Fiber.join(worker);
        })
      );

      expect(done).toBe(true);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* driver.create({ port, width: W, height: H, fps: 30 });
          })
        )
      );
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(expired).toBe(false);
    } finally {
      clearTimeout(watchdog);
      agentHolder.agent?.destroy();
    }
  }, 15000);
});

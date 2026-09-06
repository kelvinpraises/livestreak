import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { Address } from "@livestreak/schema";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import {
  forkMarketRegistrationIfNeeded,
  runMarketRegistrationLifecycle
} from "#market/registration.js";
import { validateObserveRunMarketOptions } from "#market/validate.js";
import { observeRunStreamId } from "#market/chains/evm.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult,
  paymasterFailure,
  receiptFailure
} from "#test/helpers/fake-market-registrar.js";
import { minimalEvmMarketRegistrationConfig } from "#test/helpers/market-config.js";

describe("market registration lifecycle", () => {
  it("fires exactly one registration per runId (idempotent double-start)", async () => {
    let registerCalls = 0;
    const registrar = createFakeMarketRegistrar({
      onRegister: () => {
        registerCalls += 1;
      },
      delayMs: 20
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createControlBus({
            runId: "run_idempotent",
            board: createInitialBoard({ runId: "run_idempotent", nowMs: 1 }),
            catalog: buildControlCatalog(),
            surfaces: []
          });

          const registration = minimalEvmMarketRegistrationConfig("run_idempotent");
          const input = {
            runId: "run_idempotent",
            bus,
            registration,
            registrar
          };

          yield* forkMarketRegistrationIfNeeded(input);
          yield* forkMarketRegistrationIfNeeded(input);
          yield* Effect.sleep("100 millis");
        })
      )
    );

    expect(registerCalls).toBe(1);
  });

  it("records receipt revert without affecting board run cell", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_receipt",
          board: createInitialBoard({ runId: "run_receipt", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: []
        });

        const registration = minimalEvmMarketRegistrationConfig("run_receipt");
        yield* runMarketRegistrationLifecycle({
          runId: "run_receipt",
          bus,
          registration,
          registrar: createFakeMarketRegistrar({ failWith: receiptFailure() })
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["market"]?.status[0]).toBe("failed");
      expect(exit.value.cells["market"]?.readonly).toMatchObject({ phase: "receipt" });
    }
  });

  it("records paymaster-side failure without affecting board run cell", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_paymaster",
          board: createInitialBoard({ runId: "run_paymaster", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: []
        });

        const registration = minimalEvmMarketRegistrationConfig("run_paymaster");
        yield* runMarketRegistrationLifecycle({
          runId: "run_paymaster",
          bus,
          registration,
          registrar: createFakeMarketRegistrar({ failWith: paymasterFailure() })
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["market"]?.status[0]).toBe("failed");
      expect(exit.value.cells["market"]?.readonly).toMatchObject({ phase: "paymaster" });
      expect(exit.value.cells["system:run"]?.status[0]).toBe("created");
    }
  });

  it("reaches registered when the fake registrar succeeds", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_registered",
          board: createInitialBoard({ runId: "run_registered", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: []
        });

        const registration = minimalEvmMarketRegistrationConfig("run_registered");
        yield* runMarketRegistrationLifecycle({
          runId: "run_registered",
          bus,
          registration,
          registrar: createFakeMarketRegistrar({
            result: defaultFakeRegisterResult({
              runId: "run_registered",
              title: registration.title
            })
          })
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["market"]?.status[0]).toBe("registered");
    }
  });

  it("commits registered.streamId from the registrar result", async () => {
    const runId = "run_stream_id_lifecycle";
    const streamId = observeRunStreamId(
      "0x00000000000000000000000000000000000000aa",
      runId
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId,
          board: createInitialBoard({ runId, nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: []
        });

        const registration = minimalEvmMarketRegistrationConfig(runId);
        yield* runMarketRegistrationLifecycle({
          runId,
          bus,
          registration,
          registrar: createFakeMarketRegistrar({
            result: {
              userOpHash: "0xuserop",
              marketId:
                "0x0000000000000000000000000000000000000000000000000000000000000002",
              streamId,
              title: registration.title
            }
          })
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["market"]?.readonly).toMatchObject({ streamId });
    }
  });

  it("rejects empty runId at the lifecycle boundary", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_empty",
          board: createInitialBoard({ runId: "run_empty", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: []
        });

        yield* runMarketRegistrationLifecycle({
          runId: "   ",
          bus,
          registration: minimalEvmMarketRegistrationConfig("run_empty"),
          registrar: createFakeMarketRegistrar()
        });
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects invalid market config at the kernel edge", async () => {
    const exit = await Effect.runPromiseExit(
      validateObserveRunMarketOptions({
        registration: {
          walletInit: {
            chain: "evm",
            seedSource: "raw",
            config: {
              chainId: 1,
              provider: "not-a-url",
              bundlerUrl: "not-a-url",
              isSponsored: true,
              useNativeCoins: false,
              entryPointAddress: Address.make("0x0000000000000000000000000000000000000001"),
              safe4337ModuleAddress: Address.make("0x0000000000000000000000000000000000000002"),
              safeModulesSetupAddress: Address.make("0x0000000000000000000000000000000000000003"),
              safeModulesVersion: "0.3.0",
              contractNetworks: {}
            }
          },
          seed: "",
          marketRegistryAddress: "0x0000000000000000000000000000000000000001",
          title: ""
        }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

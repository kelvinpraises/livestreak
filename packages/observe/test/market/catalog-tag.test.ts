import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { marketRegisterScope } from "#market/control.js";
import { extendBoardForMarketTests } from "#test/helpers/board.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

// Regression: the instant catalog ingest (POST /catalog/markets) must tag the market with the SAME chain
// the register used — wallet.walletInit.chain — NOT the top-level sessionInit.chain, which is a separate
// CAIP-2 field that can diverge (a solana market was once tagged "evm" and never synced into the catalog).
// Each case sets sessionInit.chain to a DELIBERATELY WRONG value to prove the tag ignores it.
const CASES = [
  {
    chain: "evm" as const,
    wrongTopLevel: "solana:localnet",
    contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" }
  },
  {
    chain: "sui" as const,
    wrongTopLevel: "eip155:1",
    contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" }
  },
  {
    chain: "solana" as const,
    wrongTopLevel: "eip155:31337",
    contracts: { solanaMarketRegistry: JSON.stringify({ programId: "Prog", usdcMint: "Usdc" }) }
  }
];

const registerOn = (
  chain: "evm" | "sui" | "solana",
  wrongTopLevel: string,
  contracts: Record<string, string>
) =>
  Effect.gen(function* () {
    const runId = `run_tag_${chain}`;
    const bus = yield* createControlBus({
      runId,
      board: extendBoardForMarketTests(createInitialBoard({ runId, nowMs: 1 }), runId),
      catalog: buildControlCatalog(),
      surfaces: createObserveControlSurfaces({
        sessionInit: {
          package: "observe",
          chain: wrongTopLevel, // deliberately NOT the wallet chain
          contracts,
          wallet: {
            chain: wrongTopLevel,
            seed: "0xseed",
            walletInit: { chain, seedSource: "raw", config: {} as never },
            operatorAddress: "0x0000000000000000000000000000000000000001"
          },
          hostUrl: "http://127.0.0.1:8787"
        } as never,
        market: {
          resolveRegistrar: () =>
            Effect.succeed(
              createFakeMarketRegistrar({ result: defaultFakeRegisterResult({ runId, title: "demo" }) })
            )
        }
      })
    });

    yield* bus.callFunction({
      callId: `reg-${chain}`,
      runId,
      scope: marketRegisterScope,
      payload: { title: "demo" }
    });
  });

describe("catalog ingest tags the chain the register used, not sessionInit.chain", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const { chain, wrongTopLevel, contracts } of CASES) {
    it(`tags a ${chain} market as "${chain}" even when sessionInit.chain says "${wrongTopLevel}"`, async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 201 }));

      await Effect.runPromise(registerOn(chain, wrongTopLevel, contracts));

      const call = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/catalog/markets"));
      expect(call, "expected a POST to /catalog/markets").toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as { chain: string };
      expect(body.chain).toBe(chain);
    });
  }
});

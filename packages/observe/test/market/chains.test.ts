import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { decodeEventLog, encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { marketRegistryAbi } from "@livestreak/contracts";
import { extractUserOperationReceiptPayload } from "#market/chains/evm.js";
import { createMarketRegistrar } from "#market/chains/index.js";
import { decodeMarketRegisteredPayload } from "#market/verify.js";
import { testPlaceholderDeriveStreamId } from "#market/types.js";
import type { ObserveRunMarketConfig } from "#market/types.js";

const marketRegisteredTopic = keccak256(toHex("MarketRegistered(bytes32,string,bytes32)"));

describe("market chain seam", () => {
  it("decodes MarketRegistered from a fixture UserOperation receipt (path a)", async () => {
    const marketId =
      "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
    const streamId =
      "0x00000000000000000000000000000000000000000000000000000000000000aa" as Hex;
    const title = "Fixture Derby";

    const data = encodeAbiParameters([{ type: "string" }], [title]);
    const topics = [marketRegisteredTopic, marketId, streamId] as const;

    const payload = await Effect.runPromise(
      extractUserOperationReceiptPayload({
        sender: "0x00000000000000000000000000000000000000aa",
        receipt: {
          logs: [
            {
              address: "0x0000000000000000000000000000000000000001",
              blockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000001",
              blockNumber: 1n,
              data,
              logIndex: 0,
              removed: false,
              transactionHash:
                "0x0000000000000000000000000000000000000000000000000000000000000002",
              transactionIndex: 0,
              topics: [...topics]
            }
          ]
        }
      })
    );

    expect(payload.sender).toBe("0x00000000000000000000000000000000000000aa");
    expect(payload.logs.length).toBe(1);

    const decodedLog = decodeEventLog({
      abi: marketRegistryAbi,
      eventName: "MarketRegistered",
      data: payload.logs[0]!.data,
      topics: payload.logs[0]!.topics
    });

    const decoded = decodeMarketRegisteredPayload({
      marketId: String(decodedLog.args.marketId),
      streamId: String(decodedLog.args.streamId),
      title: decodedLog.args.title
    });
    expect(decoded.streamId).toBe(streamId);
  });

  it("returns typed not-supported for sui wallet chain", async () => {
    const config: ObserveRunMarketConfig = {
      walletInit: {
        chain: "sui",
        seedSource: "raw",
        config: { rpcUrl: "https://example.invalid" }
      },
      seed: "test-seed",
      marketRegistryAddress: "0x0000000000000000000000000000000000000001",
      title: "Sui stream",
      deriveStreamId: testPlaceholderDeriveStreamId
    };

    const registrar = await Effect.runPromise(createMarketRegistrar(config));
    const exit = await Effect.runPromiseExit(
      registrar.registerMarket({
        runId: "run_sui",
        title: config.title,
        streamId: testPlaceholderDeriveStreamId("run_sui")
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("not supported");
    }
  });
});

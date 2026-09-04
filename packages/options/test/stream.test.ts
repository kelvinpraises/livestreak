import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId } from "../src/model/ids.js";
import type { OptionsStreamState } from "../src/model/stream.js";
import { readStreamState } from "../src/flows/stream.js";
import { createFakeOptionsReader } from "./helpers/fake-chain.js";

const marketId = asMarketId("market_01");

const streamState = (
  status: OptionsStreamState["status"],
  scheme: OptionsStreamState["scheme"],
  id = "blob_test_id"
): OptionsStreamState => ({
  status,
  scheme,
  id,
  updatedAtMs: 1_700_000_000_000,
  endedAtMs: status === "ended" ? 1_700_001_000_000 : 0
});

describe("readStreamState", () => {
  it("reads raw stream state from transport without VOD resolution", async () => {
    const transport = createFakeOptionsReader({
      streamStates: {
        market_01: streamState("ended", "walrus-testnet")
      }
    });

    const state = await readStreamState(transport, marketId);

    expect(state.status).toBe("ended");
    expect(state.scheme).toBe("walrus-testnet");
    expect(state.id).toBe("blob_test_id");
    expect(state.endedAtMs).toBe(1_700_001_000_000);
    expect(state).not.toHaveProperty("vodUrl");
  });

  it("returns live stream state without media fields", async () => {
    const transport = createFakeOptionsReader({
      streamStates: {
        market_01: streamState("live", "walrus-mainnet")
      }
    });

    const state = await readStreamState(transport, marketId);

    expect(state.status).toBe("live");
    expect(state.scheme).toBe("walrus-mainnet");
  });

  it("propagates not-found errors from transport", async () => {
    const transport = createFakeOptionsReader();

    await expect(readStreamState(transport, marketId)).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });
});

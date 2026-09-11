import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDefaultSettings, saveSettings } from "../src/prefs/settings.js";
import { readMarketIdFromBoard, runRemoteDrive } from "../src/gateway/remote/driver.js";
import { runRemoteDrive as runRemoteDriveCommand } from "../src/commands/remote.js";
import type { RemoteUiClient } from "../src/gateway/remote/ui-client.js";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    connect: vi.fn(async () => {}),
    call: vi.fn(async () => ({ ok: true })),
    boards: vi.fn(() => ({ observe: { cells: { market: { readonly: { marketId: "0xmarketdeadbeef" } } } } })),
    close: vi.fn()
  }
}));

vi.mock("../src/gateway/remote/ui-client.js", () => ({
  createRemoteUiClient: () => mockClient as unknown as RemoteUiClient
}));

const observeBoardWithMarket = (marketId: string) => ({
  cells: {
    market: {
      readonly: { marketId }
    }
  }
});

describe("remote drive", () => {
  let settingsPath: string;

  beforeEach(async () => {
    mockClient.connect.mockClear();
    mockClient.call.mockClear();
    mockClient.boards.mockClear();
    mockClient.close.mockClear();
    mockClient.call.mockResolvedValue({ ok: true });
    mockClient.boards.mockReturnValue({ observe: observeBoardWithMarket("0xmarketdeadbeef") });

    const dir = await mkdtemp(join(tmpdir(), "livestreak-drive-test-"));
    settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings());
  });

  it("observe-only calls configure then register and skips options/steward", async () => {
    const result = await runRemoteDrive({
      sessionId: "sess_observe",
      pairingPassword: "pw",
      settingsPath,
      observeOnly: true,
      log: () => {}
    });

    expect(result.marketId).toBe("0xmarketdeadbeef");
    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(mockClient.call).toHaveBeenCalledTimes(2);
    expect(mockClient.call.mock.calls[0]?.[0]).toBe("observe");
    expect(mockClient.call.mock.calls[0]?.[1]).toBe("configure");
    expect(mockClient.call.mock.calls[1]?.[0]).toBe("observe");
    expect(mockClient.call.mock.calls[1]?.[1]).toBe("register");
    expect(mockClient.call.mock.calls.some((c) => c[0] === "options")).toBe(false);
    expect(mockClient.call.mock.calls.some((c) => c[0] === "steward")).toBe(false);
  });

  it("full path runs configure through withdraw", async () => {
    const result = await runRemoteDrive({
      sessionId: "sess_full",
      pairingPassword: "pw",
      settingsPath,
      log: () => {}
    });

    expect(result.marketId).toBe("0xmarketdeadbeef");
    const actions = mockClient.call.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(actions).toEqual([
      "observe:configure",
      "observe:register",
      "options:configure",
      "options:setApprovalForAll",
      "options:fund",
      "steward:resolve",
      "options:withdraw"
    ]);
  });

  it("readMarketIdFromBoard reads market cell readonly", () => {
    expect(readMarketIdFromBoard(observeBoardWithMarket("0xabc"))).toBe("0xabc");
    expect(readMarketIdFromBoard({ cells: {} })).toBeUndefined();
  });

  it("runRemoteDrive command wrapper prints step summary", async () => {
    const output = await runRemoteDriveCommand({
      session: "sess_cmd",
      pairPassword: "pw",
      settingsPath,
      observeOnly: true
    });
    expect(output).toMatch(/remote drive complete/);
    expect(output).toMatch(/marketId=0xmarketdeadbeef/);
    expect(output).toMatch(/observe:configure=ok/);
    expect(output).toMatch(/observe:register=ok/);
  });
});

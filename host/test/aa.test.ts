import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createPaymasterSigner } from "#aa/paymaster-signer.js";
import { handleBundlerRpc, handlePaymasterRpc } from "#aa/routes.js";
import { createAaRouteDeps } from "#aa/routes.js";
import { defaultHostServerConfig } from "../src/descriptor/config.js";

const TEST_EXECUTOR_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const TEST_PAYMASTER_ADDRESS = "0x1111111111111111111111111111111111111111" as Hex;
const TEST_ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as Hex;

const fixedUserOp = {
  sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex,
  nonce: "0x0" as Hex,
  callData: "0x" as Hex,
  callGasLimit: "0x5208" as Hex,
  verificationGasLimit: "0x100000" as Hex,
  preVerificationGas: "0x5208" as Hex,
  maxFeePerGas: "0x3b9aca00" as Hex,
  maxPriorityFeePerGas: "0x3b9aca00" as Hex,
  signature: "0x" as Hex
};

const createTestAaDeps = () => {
  const signers = new Map<string, ReturnType<typeof createPaymasterSigner>>();
  signers.set("local", createPaymasterSigner(TEST_EXECUTOR_KEY, TEST_PAYMASTER_ADDRESS));
  return createAaRouteDeps(defaultHostServerConfig(), { paymasterSigners: signers });
};

describe("aa bundler proxy", () => {
  it("returns 503 JSON-RPC error when Alto is not running for the chain", async () => {
    const response = await handleBundlerRpc("local", {
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      id: 42
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: 42,
        error: {
          code: -32000,
          message: "Bundler not available for chain: local"
        }
      });
    }
  });
});

describe("aa paymaster rpc", () => {
  it("returns stub data with paymaster fields and gas limits", async () => {
    const deps = createTestAaDeps();
    const response = await handlePaymasterRpc(
      "local",
      {
        jsonrpc: "2.0",
        method: "pm_getPaymasterStubData",
        params: [],
        id: 1
      },
      deps
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.status).toBe(200);
      const body = response.body as {
        jsonrpc: string;
        id: number;
        result: {
          paymaster: string;
          paymasterData: string;
          paymasterVerificationGasLimit: string;
          paymasterPostOpGasLimit: string;
        };
      };
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);
      expect(body.result.paymaster).toBe(TEST_PAYMASTER_ADDRESS);
      expect(body.result.paymasterVerificationGasLimit).toBe("0x30000");
      expect(body.result.paymasterPostOpGasLimit).toBe("0x10000");
      expect(body.result.paymasterData.startsWith("0x")).toBe(true);
      expect(body.result.paymasterData.length).toBeGreaterThanOrEqual(194);
      expect((body.result.paymasterData.length - 2) % 2).toBe(0);
    }
  });

  it("returns signed paymaster data for pm_getPaymasterData", async () => {
    const deps = createTestAaDeps();
    const response = await handlePaymasterRpc(
      "local",
      {
        jsonrpc: "2.0",
        method: "pm_getPaymasterData",
        params: [fixedUserOp, TEST_ENTRY_POINT, "0x7a69"],
        id: 7
      },
      deps
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      const body = response.body as {
        result: {
          paymaster: string;
          paymasterData: string;
          paymasterVerificationGasLimit: string;
          paymasterPostOpGasLimit: string;
        };
      };
      expect(body.result.paymaster).toBe(TEST_PAYMASTER_ADDRESS);
      expect(body.result.paymasterVerificationGasLimit).toBe("0x30000");
      expect(body.result.paymasterPostOpGasLimit).toBe("0x10000");
      expect(body.result.paymasterData.startsWith("0x")).toBe(true);
      expect(body.result.paymasterData.length).toBeGreaterThanOrEqual(194);
      expect((body.result.paymasterData.length - 2) % 2).toBe(0);
    }
  });

  it("returns -32601 for unknown methods", async () => {
    const deps = createTestAaDeps();
    const response = await handlePaymasterRpc(
      "local",
      {
        jsonrpc: "2.0",
        method: "pm_unknown",
        params: [],
        id: 3
      },
      deps
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32601, message: "Method not found: pm_unknown" }
      });
    }
  });

  it("returns 503 when no signer is configured for the chain", async () => {
    const deps = createAaRouteDeps(defaultHostServerConfig());
    const response = await handlePaymasterRpc(
      "local",
      {
        jsonrpc: "2.0",
        method: "pm_getPaymasterStubData",
        params: [],
        id: 9
      },
      deps
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: 9,
        error: {
          code: -32000,
          message: "Paymaster not available for chain: local"
        }
      });
    }
  });
});

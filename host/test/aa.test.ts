import type { Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAaRouteDeps } from "#deps.js";
import { proxyBundlerRpc } from "#features/aa/evm.js";
import { createAaHandlers } from "#features/aa/routes.js";
import { defaultHostServerConfig } from "#config/host.js";

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

describe("aa bundler proxy", () => {
  it("returns 503 JSON-RPC error when no hosted bundler is configured for the chain", async () => {
    const proxied = await proxyBundlerRpc("local", {
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      id: 42
    });

    expect(proxied.status).toBe(503);
    expect(proxied.body).toMatchObject({
      jsonrpc: "2.0",
      id: 42,
      error: {
        code: -32000,
        message: "Bundler not available for chain: local"
      }
    });
  });
});

describe("hosted AA forwarding", () => {
  afterEach(() => vi.unstubAllGlobals());
  const depsFor = (authenticated = false) => {
    const deps = createAaRouteDeps(defaultHostServerConfig());
    return { ...deps, aa: {
      ...deps.aa,
      requirePaymasterAuth: authenticated,
      ...(authenticated ? { paymasterAuthToken: 'host-secret' } : {}),
      chains: [{ routeKey: 'base-sepolia', chainId: 84532, name: 'Base Sepolia',
        entryPoint: TEST_ENTRY_POINT, bundlerUrl: 'https://provider.test/bundler',
        paymasterUrl: 'https://provider.test/paymaster' }],
    } };
  };
  const capture = () => {
    let status = 0;
    let body: unknown;
    return { res: { status: (code: number) => ({ json: (value: unknown) => { status = code; body = value; } }) },
      result: () => ({ status, body }) };
  };

  it("forwards to the configured bundler and preserves its gas estimate", async () => {
    const envelope = { jsonrpc: '2.0', id: 12, result: { callGasLimit: '0x100' } };
    const fetcher = vi.fn().mockResolvedValue({ status: 200, json: async () => envelope });
    vi.stubGlobal('fetch', fetcher);
    const body = { jsonrpc: '2.0', method: 'eth_estimateUserOperationGas', params: [], id: 12 };
    const result = await proxyBundlerRpc('base-sepolia', body, depsFor().aa);
    expect(result).toEqual({ status: 200, body: envelope });
    expect(fetcher).toHaveBeenCalledWith('https://provider.test/bundler', expect.objectContaining({ body: JSON.stringify(body) }));
  });

  it("never forwards administration methods", async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await proxyBundlerRpc('base-sepolia', { method: 'anvil_setBalance', id: 13 }, depsFor().aa);
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires authorization before requesting hosted sponsorship", async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const out = capture();
    await createAaHandlers(depsFor(true)).paymaster({ params: { chain: 'base-sepolia' }, body: {
      method: 'pm_getPaymasterData', params: [fixedUserOp, TEST_ENTRY_POINT, '0x14a34'], id: 14,
    } }, out.res);
    expect(out.result().status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['0x1', '0x', 'garbage'])("rejects mismatched or malformed chain %s before forwarding", async chainId => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const out = capture();
    await createAaHandlers(depsFor()).paymaster({ params: { chain: 'base-sepolia' }, body: {
      method: 'pm_getPaymasterData', params: [fixedUserOp, TEST_ENTRY_POINT, chainId], id: 15,
    } }, out.res);
    expect(out.result().body).toMatchObject({ id: 15, error: { code: -32602 } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards valid sponsorship without exposing the Host bearer token upstream", async () => {
    const envelope = { jsonrpc: '2.0', id: 16, result: { paymaster: TEST_PAYMASTER_ADDRESS } };
    const fetcher = vi.fn().mockResolvedValue({ status: 200, json: async () => envelope });
    vi.stubGlobal('fetch', fetcher);
    const out = capture();
    await createAaHandlers(depsFor(true)).paymaster({ params: { chain: 'base-sepolia' }, headers: { authorization: 'Bearer host-secret' }, body: {
      method: 'pm_getPaymasterData', params: [fixedUserOp, TEST_ENTRY_POINT, '0x14a34'], id: 16,
    } }, out.res);
    expect(out.result()).toEqual({ status: 200, body: envelope });
    expect(fetcher).toHaveBeenCalledWith('https://provider.test/paymaster', expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }));
  });

  it("returns a bounded unavailable response without leaking upstream credentials", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://provider.test/secret')));
    const result = await proxyBundlerRpc('base-sepolia', { method: 'eth_chainId', id: 17 }, depsFor().aa);
    expect(result).toMatchObject({ status: 503, body: { id: 17, error: { message: 'Bundler unavailable' } } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

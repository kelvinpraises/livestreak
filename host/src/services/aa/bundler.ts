import type { Hex } from "viem";
import { getAltoPort } from "../../infrastructure/bundler/alto.js";
import { resolveAaChain, type AaServerConfig } from "./chains.js";
import {
  BUNDLER_REVERT_DECODE_METHODS,
  enrichBundlerJsonRpcError
} from "./decode-userop-revert.js";

// --- exports ---

interface JsonRpcRequestBody {
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly params?: unknown[];
  readonly id?: unknown;
}

export const proxyBundlerRpc = async (
  routeKey: string,
  body: unknown
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const request = asJsonRpcRequest(body);

  if (routeKey.length === 0) {
    return jsonRpcEnvelope(400, request.id, -32600, "chain path parameter is required");
  }

  // H3: only forward the enumerable ERC-4337 / pimlico userOp methods. Reject
  // anything else (debug_*, admin_*, anvil_*, eth_sendRawTransaction, …) so the
  // proxy is not an open relay to the underlying bundler/node RPC.
  const method = request.body.method;
  if (typeof method !== "string" || !BUNDLER_METHOD_ALLOWLIST.has(method)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[aa:bundler] rejected non-allowlisted method: ${String(method)}`);
    }
    return jsonRpcEnvelope(
      400,
      request.id,
      -32601,
      `Method not allowed: ${typeof method === "string" ? method : "missing"}`
    );
  }

  const port = getAltoPort(routeKey);
  if (port === null) {
    return jsonRpcEnvelope(503, request.id, -32000, `Bundler not available for chain: ${routeKey}`);
  }

  try {
    const response = await fetch(`http://localhost:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body)
    });
    let data = await response.json();
    if (method === "eth_estimateUserOperationGas") {
      data = bufferEstimateCallGasLimit(data);
    }
    if (BUNDLER_REVERT_DECODE_METHODS.has(method)) {
      data = enrichBundlerJsonRpcError(data);
    }
    return {
      status: response.status,
      body: data
    };
  } catch {
    return jsonRpcEnvelope(503, request.id, -32000, "Bundler unavailable");
  }
};

// The bundler's callGasLimit estimate is the gas the EntryPoint forwards to the Safe
// account's executeUserOp. The Safe 4337 module then calls the target with gasleft()
// minus its own overhead, and the EVM 63/64 gas-forwarding rule shaves a little more —
// so a tight estimate can leave a gas-heavy inner call (e.g. Drips setStreams in
// createVault/fund) a few thousand gas short, reverting as the module's masked
// ExecutionFailed(). Inflate the estimate by 50% at the single point every party reads
// it (estimate → paymaster sign → submit) so headroom stays consistent with the
// paymaster signature. Verification/preVerification gas are left untouched.
const CALL_GAS_LIMIT_BUFFER_NUM = 3n;
const CALL_GAS_LIMIT_BUFFER_DEN = 2n;

const bufferEstimateCallGasLimit = (data: unknown): unknown => {
  if (data === null || typeof data !== "object") {
    return data;
  }

  const envelope = data as { result?: unknown };
  const result = envelope.result;
  if (result === null || typeof result !== "object") {
    return data;
  }

  const gas = result as { callGasLimit?: unknown };
  const buffered = scaleHexQuantity(gas.callGasLimit, CALL_GAS_LIMIT_BUFFER_NUM, CALL_GAS_LIMIT_BUFFER_DEN);
  if (buffered === undefined) {
    return data;
  }

  return { ...envelope, result: { ...gas, callGasLimit: buffered } };
};

const scaleHexQuantity = (value: unknown, num: bigint, den: bigint): Hex | undefined => {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return undefined;
  }

  try {
    const scaled = (BigInt(value) * num) / den;
    return `0x${scaled.toString(16)}` as Hex;
  } catch {
    return undefined;
  }
};

// Canonical ERC-4337 bundler methods + the pimlico extensions Safe4337Pack /
// permissionless relay-kit actually emit. Extend here if a client needs more.
const BUNDLER_METHOD_ALLOWLIST: ReadonlySet<string> = new Set([
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "eth_supportedEntryPoints",
  "eth_chainId",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus"
]);

export const resolveBundlerChain = (aa: AaServerConfig, routeKey: string) =>
  resolveAaChain(aa, routeKey);

// --- helpers ---

const asJsonRpcRequest = (
  body: unknown
): { readonly body: JsonRpcRequestBody; readonly id: unknown } => {
  if (body === null || typeof body !== "object") {
    return { body: {}, id: null };
  }

  const request = body as JsonRpcRequestBody;
  return {
    body: request,
    id: request.id ?? null
  };
};

const jsonRpcEnvelope = (
  status: number,
  id: unknown,
  code: number,
  message: string
): { readonly status: number; readonly body: unknown } => ({
  status,
  body: {
    jsonrpc: "2.0",
    error: { code, message },
    id
  }
});

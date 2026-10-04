import { resolveAaChain, type AaServerConfig } from "../../config/aa.js";
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
  body: unknown,
  aa?: AaServerConfig
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

  const url = aa === undefined ? undefined : resolveAaChain(aa, routeKey)?.bundlerUrl;
  if (url === undefined) {
    return jsonRpcEnvelope(503, request.id, -32000, `Bundler not available for chain: ${routeKey}`);
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body)
    });
    let data = await response.json();
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

// Called after the controller's sponsorship authorization and chain checks.
export const proxyPaymasterRpc = async (
  url: string,
  body: unknown
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const request = asJsonRpcRequest(body);
  if (!['pm_getPaymasterStubData', 'pm_getPaymasterData'].includes(request.body.method ?? '')) {
    return jsonRpcEnvelope(400, request.id, -32601, "Paymaster method not allowed");
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body)
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return jsonRpcEnvelope(503, request.id, -32000, "Paymaster unavailable");
  }
};

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

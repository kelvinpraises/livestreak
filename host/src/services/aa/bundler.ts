import type { Hex } from "viem";
import { getAltoPort } from "../../infrastructure/bundler/alto.js";
import { resolveAaChain, type AaServerConfig } from "./chains.js";

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
    const data = await response.json();
    return { status: response.status, body: data };
  } catch {
    return jsonRpcEnvelope(503, request.id, -32000, "Bundler unavailable");
  }
};

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

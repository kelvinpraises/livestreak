import type { AaCapabilityDescriptor } from "@livestreak/host";
import type { Hex } from "viem";
import type { JsonResponse } from "../../interfaces/api/response.js";
import { jsonSuccess } from "../../interfaces/api/response.js";
import type { HostServerConfig } from "../../config/host.js";
import { proxyBundlerRpc } from "../../infrastructure/bundler/bundler.js";
import {
  buildPaymasterSigners,
  readAaServerConfig,
  resolveAaChain,
  type AaServerConfig
} from "./chains.js";
import type { PackedUserOp, PaymasterSigner } from "./paymaster.js";

// --- exports ---

export interface AaRouteDeps {
  readonly config: HostServerConfig;
  readonly aa: AaServerConfig;
  readonly paymasterSigners: Map<string, PaymasterSigner>;
}

export interface CreateAaRouteDepsOptions {
  readonly paymasterSigners?: Map<string, PaymasterSigner>;
}

export const createAaRouteDeps = (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {}
): AaRouteDeps => {
  const aa = readAaServerConfig(config);

  return {
    config,
    aa,
    paymasterSigners: options.paymasterSigners ?? new Map()
  };
};

export const createAaRouteDepsAsync = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {}
): Promise<AaRouteDeps> => {
  const aa = readAaServerConfig(config);

  return {
    config,
    aa,
    paymasterSigners: options.paymasterSigners ?? (await buildPaymasterSigners(aa, config))
  };
};

export const handleAaDescriptor = (deps: AaRouteDeps): AaCapabilityDescriptor => ({
  version: "0.1.0",
  hostId: deps.config.hostId,
  sponsorshipMode: deps.aa.sponsorshipMode,
  supportedOperations: [...deps.aa.supportedOperations],
  paymasterPath: deps.aa.paymasterPath,
  chains: deps.aa.chains.map((chain) => ({
    chainId: chain.chainId,
    name: chain.name,
    entryPoint: chain.entryPoint,
    safeModule: chain.safeModule,
    bundlerPath: `/aa/bundler/${chain.routeKey}`,
    rpcUrl: chain.rpcUrl
  }))
});

export const handleBundlerRpc = async (
  chain: string | undefined,
  body: unknown,
  aa: AaServerConfig
): Promise<JsonResponse<unknown>> => {
  const request = asJsonRpcRequest(body);
  const routeKey = chain ?? "";

  if (routeKey.length === 0) {
    return jsonRpcError(400, request.id, -32600, "chain path parameter is required");
  }

  const chainConfig = resolveAaChain(aa, routeKey);
  const bundlerUrl = chainConfig?.bundlerUrl;

  const proxied = await proxyBundlerRpc(bundlerUrl, request.body);
  if (!proxied.ok) {
    return jsonRpcError(
      proxied.status,
      request.id,
      proxied.code,
      proxied.message === "bundler_not_configured"
        ? `Bundler not available for chain: ${routeKey}`
        : proxied.message
    );
  }

  return jsonSuccess(proxied.status, proxied.body);
};

export const handlePaymasterRpc = async (
  chain: string | undefined,
  body: unknown,
  deps: AaRouteDeps
): Promise<JsonResponse<unknown>> => {
  const request = asJsonRpcRequest(body);
  const routeKey = chain ?? "";

  if (routeKey.length === 0) {
    return jsonRpcError(400, request.id, -32600, "chain path parameter is required");
  }

  const signer = deps.paymasterSigners.get(routeKey);
  if (signer === undefined) {
    return jsonRpcError(503, request.id, -32000, `Paymaster not available for chain: ${routeKey}`);
  }

  const { method, params, id } = request.body;

  try {
    if (method === "pm_getPaymasterStubData") {
      const result = await signer.signStub();
      return jsonSuccess(200, { jsonrpc: "2.0", id, result });
    }

    if (method === "pm_getPaymasterData") {
      const rpcParams = params ?? [];
      const userOp = rpcParams[0] as PackedUserOp;
      const entryPoint = rpcParams[1] as Hex;
      const chainId = rpcParams[2] as Hex;
      const result = await signer.signFromUserOp(userOp, entryPoint, chainId);
      return jsonSuccess(200, { jsonrpc: "2.0", id, result });
    }

    return jsonSuccess(200, {
      jsonrpc: "2.0",
      error: { code: -32601, message: `Method not found: ${String(method)}` },
      id
    });
  } catch (error) {
    return jsonRpcError(500, id, -32000, `Paymaster error: ${String(error)}`);
  }
};

// --- helpers ---

interface JsonRpcRequestBody {
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly params?: unknown[];
  readonly id?: unknown;
}

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

const jsonRpcError = (
  status: number,
  id: unknown,
  code: number,
  message: string
): JsonResponse<unknown> =>
  jsonSuccess(status, {
    jsonrpc: "2.0",
    error: { code, message },
    id
  });

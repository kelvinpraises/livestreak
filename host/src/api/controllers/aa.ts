import type { AaCapabilityDescriptor } from "@livestreak/host";
import type { AaChainConfig } from "../../services/aa/chains.js";
import type { Hex } from "viem";
import type { AaRouteDeps } from "../aa-deps.js";
import { proxyBundlerRpc } from "../../services/aa/bundler.js";
import type { PackedUserOp } from "../../services/aa/paymaster.js";

// --- exports ---

export const createAaController = (deps: AaRouteDeps) => ({
  descriptor: (_req: unknown, res: { json: (body: unknown) => void }): void => {
    res.json(buildAaDescriptor(deps));
  },

  bundler: async (
    req: { params: { chain?: string }; body: unknown },
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<void> => {
    const routeKey = req.params.chain ?? "";
    const proxied = await proxyBundlerRpc(routeKey, req.body);
    res.status(proxied.status).json(proxied.body);
  },

  paymaster: async (
    req: { params: { chain?: string }; body: unknown },
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<void> => {
    const routeKey = req.params.chain ?? "";
    const request = asJsonRpcRequest(req.body);

    if (routeKey.length === 0) {
      res.status(400).json(jsonRpcError(-32600, "chain path parameter is required", request.id));
      return;
    }

    const signer = deps.paymasterSigners.get(routeKey);
    if (signer === undefined) {
      res
        .status(503)
        .json(jsonRpcError(-32000, `Paymaster not available for chain: ${routeKey}`, request.id));
      return;
    }

    const { method, params, id } = request.body;

    try {
      if (method === "pm_getPaymasterStubData") {
        const result = await signer.signStub();
        res.status(200).json({ jsonrpc: "2.0", id, result });
        return;
      }

      if (method === "pm_getPaymasterData") {
        const rpcParams = params ?? [];
        const userOp = rpcParams[0] as PackedUserOp;
        const entryPoint = rpcParams[1] as Hex;
        const chainId = rpcParams[2] as Hex;
        const result = await signer.signFromUserOp(userOp, entryPoint, chainId);
        res.status(200).json({ jsonrpc: "2.0", id, result });
        return;
      }

      res.status(200).json({
        jsonrpc: "2.0",
        error: { code: -32601, message: `Method not found: ${String(method)}` },
        id
      });
    } catch (error) {
      res.status(500).json(jsonRpcError(-32000, `Paymaster error: ${String(error)}`, id));
    }
  }
});

const buildAaDescriptor = (deps: AaRouteDeps): AaCapabilityDescriptor => ({
  version: "0.1.0",
  hostId: deps.config.hostId,
  sponsorshipMode: deps.aa.sponsorshipMode,
  supportedOperations: [...deps.aa.supportedOperations],
  paymasterPath: deps.aa.paymasterPath,
  chains: deps.aa.chains.map((chain: AaChainConfig) => ({
    chainId: chain.chainId,
    name: chain.name,
    entryPoint: chain.entryPoint,
    safeModule: chain.safeModule,
    bundlerPath: `/aa/bundler/${chain.routeKey}`,
    rpcUrl: chain.rpcUrl
  }))
});

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

const jsonRpcError = (code: number, message: string, id: unknown) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id
});

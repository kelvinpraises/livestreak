import type {
  AaCapabilityDescriptor,
  AaChainDescriptor,
  SuiSponsorshipDescriptor
} from "@livestreak/host";
import type { AaChainConfig } from "../../services/aa/chains.js";
import type { Hex } from "viem";
import type { AaRouteDeps } from "../../deps.js";
import { proxyBundlerRpc } from "../../services/aa/bundler.js";
import { resolveAaChain } from "../../services/aa/chains.js";
import type { PackedUserOp } from "../../services/aa/paymaster.js";
import { handleSuiSponsor } from "../../services/aa/sui-sponsor.js";
import { sendRouteResult } from "../middleware/respond.js";
import type { NextFunction, Request, Response } from "express";

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
    req: {
      params: { chain?: string };
      body: unknown;
      headers?: Record<string, unknown>;
    },
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<void> => {
    const routeKey = req.params.chain ?? "";
    const request = asJsonRpcRequest(req.body);

    if (routeKey.length === 0) {
      res.status(400).json(jsonRpcError(-32600, "chain path parameter is required", request.id));
      return;
    }

    // H1: open `dev_open` sponsorship is loopback-only. On a non-loopback bind
    // the route refuses to sponsor unless a matching bearer token is presented,
    // so a public host cannot be drained of free gas.
    if (deps.aa.requirePaymasterAuth) {
      if (deps.aa.paymasterAuthToken === undefined) {
        res
          .status(503)
          .json(
            jsonRpcError(-32000, "Paymaster sponsorship is disabled on this host", request.id)
          );
        return;
      }
      if (!hasValidBearer(req.headers, deps.aa.paymasterAuthToken)) {
        res.status(401).json(jsonRpcError(-32001, "Paymaster authorization required", request.id));
        return;
      }
    }

    const signer = deps.paymasterSigners.get(routeKey);
    if (signer === undefined) {
      res
        .status(503)
        .json(jsonRpcError(-32000, `Paymaster not available for chain: ${routeKey}`, request.id));
      return;
    }

    // May be undefined when a signer is injected directly (tests). In production
    // a signer always implies a configured chain (see buildPaymasterSigners).
    const chain = resolveAaChain(deps.aa, routeKey);
    const routeChainId = chain === undefined ? undefined : BigInt(chain.chainId);

    const { method, params, id } = request.body;

    try {
      if (method === "pm_getPaymasterStubData") {
        // M1: thread the route chain's real chainId (no hardcoded 31337).
        const result = await signer.signStub(routeChainId);
        res.status(200).json({ jsonrpc: "2.0", id, result });
        return;
      }

      if (method === "pm_getPaymasterData") {
        const rpcParams = params ?? [];
        const userOp = rpcParams[0];
        const entryPoint = rpcParams[1];
        const chainId = rpcParams[2];

        // H2: validate the userOp shape + entryPoint/chainId before signing,
        // instead of blind-casting untrusted JSON-RPC params.
        if (!isPackedUserOp(userOp) || !isHex(entryPoint) || !isHex(chainId)) {
          res.status(200).json(jsonRpcError(-32602, "Invalid pm_getPaymasterData params", id));
          return;
        }

        // H2 anti-replay: the userOp's chainId MUST match the route chain so a
        // signature obtained on one chain cannot be replayed on another.
        if (routeChainId !== undefined && BigInt(chainId) !== routeChainId) {
          res
            .status(200)
            .json(jsonRpcError(-32602, "chainId does not match the paymaster route chain", id));
          return;
        }

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
      // M6: log full error server-side, return a generic message (no leak of
      // internal error details to the caller).
      console.error(`[aa:paymaster] signing failed for chain ${routeKey}:`, error);
      res.status(500).json(jsonRpcError(-32000, "Paymaster signing failed", id));
    }
  },

  suiSponsor: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!deps.suiGasStation.configured) {
      res.status(503).json({
        error: {
          message: "Sui gas station is not configured",
          metadata: { retryable: false }
        }
      });
      return;
    }

    sendRouteResult(
      res,
      await handleSuiSponsor(req.body, {
        sponsor: (input) => deps.suiGasStation.sponsor(input)
      }),
      next
    );
  }
});

// Host-local emit types: a superset of the canonical descriptor that adds a
// per-chain `paymasterPath` (H5). The route is `/aa/paymaster/:chain`, so the
// path MUST be per-chain — symmetric with `bundlerPath`. The canonical
// `AaChainDescriptor` (schema-foundations, `packages/host`) does not yet carry
// this field; cross-ask filed in `context/temp-convo/schema/inbox/`. Effect
// Schema ignores excess properties on decode, so emitting it is back-compat-safe
// for current consumers, and the top-level `paymasterPath` is kept for back-compat.
interface AaChainDescriptorEmit extends AaChainDescriptor {
  readonly paymasterPath: string;
}

interface AaCapabilityDescriptorEmit extends Omit<AaCapabilityDescriptor, "chains"> {
  readonly chains: readonly AaChainDescriptorEmit[];
}

const buildAaDescriptor = (deps: AaRouteDeps): AaCapabilityDescriptorEmit => ({
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
    paymasterPath: `/aa/paymaster/${chain.routeKey}`,
    rpcUrl: chain.rpcUrl
  })),
  ...(buildSuiSponsorshipDescriptor(deps) === undefined
    ? {}
    : { suiSponsorship: buildSuiSponsorshipDescriptor(deps) })
});

const buildSuiSponsorshipDescriptor = (deps: AaRouteDeps): SuiSponsorshipDescriptor | undefined => {
  if (!deps.suiGasStation.configured || !deps.suiGasStation.advertise) {
    return undefined;
  }

  return {
    gasStationPath: deps.suiGasStation.gasStationPath,
    ...(deps.suiGasStation.sponsorAddress === null
      ? {}
      : { sponsorAddress: deps.suiGasStation.sponsorAddress })
  };
};

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

const isHex = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value);

// H2: structural guard for the ERC-4337 PackedUserOperation. Required fields
// must be present and hex-encoded; optional account/paymaster fields, when
// present, must also be hex (or null). No blind casting of untrusted params.
const REQUIRED_USEROP_HEX_FIELDS = [
  "sender",
  "nonce",
  "callData",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "signature"
] as const;

const OPTIONAL_USEROP_HEX_FIELDS = [
  "factory",
  "factoryData",
  "paymaster",
  "paymasterData",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit"
] as const;

const isPackedUserOp = (value: unknown): value is PackedUserOp => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const op = value as Record<string, unknown>;
  for (const field of REQUIRED_USEROP_HEX_FIELDS) {
    if (!isHex(op[field])) {
      return false;
    }
  }

  for (const field of OPTIONAL_USEROP_HEX_FIELDS) {
    const fieldValue = op[field];
    if (fieldValue !== undefined && fieldValue !== null && !isHex(fieldValue)) {
      return false;
    }
  }

  return true;
};

const hasValidBearer = (
  headers: Record<string, unknown> | undefined,
  expectedToken: string
): boolean => {
  const raw = headers?.authorization ?? headers?.Authorization;
  if (typeof raw !== "string") {
    return false;
  }

  const match = /^Bearer\s+(.+)$/u.exec(raw.trim());
  return match !== null && match[1] === expectedToken;
};

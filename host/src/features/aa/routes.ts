import type {
  AaCapabilityDescriptor,
  AaChainDescriptor,
  SolanaSponsorshipDescriptor,
  SuiSponsorshipDescriptor
} from "@livestreak/host";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Hex } from "viem";
import type { AaChainConfig } from "../../config/aa.js";
import { resolveAaChain } from "../../config/aa.js";
import type { AaRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../../http/respond.js";
import { proxyBundlerRpc, proxyPaymasterRpc } from "./evm.js";
import { handleSuiSponsor } from "./sui.js";

// --- exports ---

export const createAaRouter = (deps: AaRouteDeps): Router => {
  const router = Router();
  const handlers = createAaHandlers(deps);

  router.get("/aa/descriptor", (_req, res) => handlers.descriptor(_req, res));
  router.post(
    "/aa/bundler/:chain",
    asyncHandler(async (req, res) => handlers.bundler(req, res))
  );
  router.post(
    "/aa/paymaster/:chain",
    asyncHandler(async (req, res) => handlers.paymaster(req, res))
  );
  router.post(
    "/aa/sui/sponsor",
    asyncHandler(async (req, res, next) => handlers.suiSponsor(req, res, next))
  );
  router.post(
    "/aa/solana/paymaster",
    asyncHandler(async (req, res) => handlers.solanaPaymaster(req, res))
  );

  return router;
};


// --- exports ---

export const createAaHandlers = (deps: AaRouteDeps) => ({
  descriptor: (_req: unknown, res: { json: (body: unknown) => void }): void => {
    res.json(buildAaDescriptor(deps));
  },

  bundler: async (
    req: { params: { chain?: string }; body: unknown },
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<void> => {
    const routeKey = req.params.chain ?? "";
    const proxied = await proxyBundlerRpc(routeKey, req.body, deps.aa);
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

    const chain = resolveAaChain(deps.aa, routeKey);
    if (chain?.paymasterUrl !== undefined) {
      const { method, params, id } = request.body;
      if (method !== 'pm_getPaymasterStubData' && method !== 'pm_getPaymasterData') {
        res.status(200).json(jsonRpcError(-32601, "Paymaster method not allowed", id));
        return;
      }
      // Hosted sponsorship must be bound to this route's network and EntryPoint.
      if (!Array.isArray(params) || !isPackedUserOp(params[0]) ||
          !isHex(params[1]) || params[1].toLowerCase() !== chain.entryPoint.toLowerCase() ||
          !isHex(params[2]) || params[2] === '0x' || BigInt(params[2]) !== BigInt(chain.chainId)) {
        res.status(200).json(jsonRpcError(-32602, "Invalid paymaster params for route chain", id));
        return;
      }
      const proxied = await proxyPaymasterRpc(chain.paymasterUrl, req.body);
      res.status(proxied.status).json(proxied.body);
      return;
    }

    res.status(503).json(jsonRpcError(-32000,
      `Paymaster not available for chain: ${routeKey}`, request.id));
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
  },

  solanaPaymaster: async (
    req: { body: unknown; headers?: Record<string, unknown> },
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<void> => {
    const request = asJsonRpcRequest(req.body);

    if (!deps.solanaPaymaster.configured) {
      res
        .status(503)
        .json(jsonRpcError(-32000, "Solana paymaster is not configured", request.id));
      return;
    }

    // Same H1 drain-protection as the EVM paymaster: open sponsorship is loopback-only;
    // a non-loopback bind requires the bearer token before the host co-signs anything.
    if (deps.aa.requirePaymasterAuth) {
      if (deps.aa.paymasterAuthToken === undefined) {
        res
          .status(503)
          .json(jsonRpcError(-32000, "Paymaster sponsorship is disabled on this host", request.id));
        return;
      }
      if (!hasValidBearer(req.headers, deps.aa.paymasterAuthToken)) {
        res.status(401).json(jsonRpcError(-32001, "Paymaster authorization required", request.id));
        return;
      }
    }

    const result = await deps.solanaPaymaster.handleRpc(req.body);
    res.status(result.status).json(result.body);
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
    : { suiSponsorship: buildSuiSponsorshipDescriptor(deps) }),
  ...(buildSolanaSponsorshipDescriptor(deps) === undefined
    ? {}
    : { solanaSponsorship: buildSolanaSponsorshipDescriptor(deps) })
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

const buildSolanaSponsorshipDescriptor = (
  deps: AaRouteDeps
): SolanaSponsorshipDescriptor | undefined => {
  if (!deps.solanaPaymaster.configured || !deps.solanaPaymaster.advertise) {
    return undefined;
  }

  return {
    paymasterPath: deps.solanaPaymaster.paymasterPath,
    ...(deps.solanaPaymaster.payerAddress === null
      ? {}
      : { payerAddress: deps.solanaPaymaster.payerAddress }),
    // Token-free by default: payerAddress + rpcUrl is all the app needs (solanaWalletInitFromDescriptor
    // sponsors on the payer alone, no fee token). feeTokens is advertised ONLY when explicitly set
    // (LIVESTREAK_SOLANA_FEE_TOKENS) to opt into the legacy Kora fee-token flow; omitted when empty.
    ...(deps.solanaPaymaster.feeTokens.length === 0
      ? {}
      : { feeTokens: [...deps.solanaPaymaster.feeTokens] }),
    ...(deps.solanaPaymaster.rpcUrl === null ? {} : { rpcUrl: deps.solanaPaymaster.rpcUrl })
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

const isPackedUserOp = (value: unknown): value is Record<string, Hex> => {
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

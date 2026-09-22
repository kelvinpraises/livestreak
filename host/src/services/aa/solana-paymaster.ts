import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getBase64Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  solanaAddress
} from "@livestreak/wallet";
import { readOptionalEnv } from "../../config/env.js";
import type { HostServerConfig } from "../../config/host.js";
import {
  resolveSolanaPayerSeed,
  resolveSolanaPayerWallet,
  resolveSolanaRpcUrl
} from "../../infrastructure/wallet/solana.js";

// --- exports ---

// The wire protocol is Kora JSON-RPC (what @solana/kora's KoraClient speaks). Three interchangeable
// implementations sit behind the same path so the wallet kit cannot tell them apart:
//   in-process — the host's fee-payer keypair co-signs directly (dev default, price: free)
//   proxy      — forward allowlisted methods to a real kora node (LIVESTREAK_KORA_URL, or spawned)
export const SOLANA_PAYMASTER_PATH = "/aa/solana/paymaster";

// Least surface: only what the gasless kit + its tooling actually call. transferTransaction is
// deliberately excluded — it has the paymaster BUILD transactions, not just co-sign them.
export const KORA_METHOD_ALLOWLIST = [
  "getConfig",
  "getPayerSigner",
  "getBlockhash",
  "getSupportedTokens",
  "estimateTransactionFee",
  "signTransaction",
  "signAndSendTransaction"
] as const;

export interface SolanaPaymasterRuntimeConfig {
  readonly rpcUrl: string;
  readonly payerAddress: string;
  readonly payerPrivateKey: Uint8Array;
  /** SPL mints advertised as accepted fee tokens. Dev pricing is `free`, so these are advisory. */
  readonly feeTokens: readonly string[];
  /** When set, forward to a real kora node instead of signing in-process. */
  readonly koraUrl: string | null;
}

export interface SolanaPaymasterService {
  readonly configured: boolean;
  readonly advertise: boolean;
  readonly payerAddress: string | null;
  readonly paymasterPath: typeof SOLANA_PAYMASTER_PATH;
  /** SPL fee-token mints the paymaster leg accepts, advertised in the AA descriptor. */
  readonly feeTokens: readonly string[];
  /** The paymaster leg's configured RPC, advertised so the wallet reuses the same endpoint. */
  readonly rpcUrl: string | null;
  bootstrap(): Promise<void>;
  handleRpc(body: unknown): Promise<{ readonly status: number; readonly body: unknown }>;
}

export const createSolanaPaymaster = (options: {
  readonly config: SolanaPaymasterRuntimeConfig | null;
}): SolanaPaymasterService => {
  if (options.config === null) {
    return createDisabledSolanaPaymaster();
  }

  return createEnabledSolanaPaymaster(options.config);
};

export const readSolanaPaymasterRuntimeConfig = async (
  config: HostServerConfig
): Promise<SolanaPaymasterRuntimeConfig | null> => {
  const seed = resolveSolanaPayerSeed(config);
  const rpcUrl = resolveSolanaRpcUrl();
  if (seed === null || rpcUrl === null) {
    return null;
  }

  const payer = await resolveSolanaPayerWallet(config);
  const feeTokensRaw = readOptionalEnv("LIVESTREAK_SOLANA_FEE_TOKENS");
  const envFeeTokens =
    feeTokensRaw === null
      ? []
      : feeTokensRaw
          .split(",")
          .map((token) => token.trim())
          .filter((token) => token.length > 0);

  // Token-free by default: the free-price paymaster co-signs as fee payer and takes NOTHING, so it
  // advertises NO fee token. The app then builds a token-free config (sponsor pays SOL, no fee-token
  // transfer, no sponsor fee-token ATA needed — the prod-safe path). Set LIVESTREAK_SOLANA_FEE_TOKENS
  // ONLY to opt a real Kora node into the legacy fee-token flow.
  const feeTokens = envFeeTokens;

  return {
    rpcUrl,
    payerAddress: payer.address,
    payerPrivateKey: payer.privateKey,
    feeTokens,
    koraUrl: readOptionalEnv("LIVESTREAK_KORA_URL")
  };
};

// --- helpers ---

const createDisabledSolanaPaymaster = (): SolanaPaymasterService => ({
  configured: false,
  advertise: false,
  payerAddress: null,
  paymasterPath: SOLANA_PAYMASTER_PATH,
  feeTokens: [],
  rpcUrl: null,
  async bootstrap() {
    return;
  },
  async handleRpc(body) {
    const id = readJsonRpcId(body);
    return {
      status: 503,
      body: jsonRpcError(-32000, "Solana paymaster is not configured", id)
    };
  }
});

const createEnabledSolanaPaymaster = (
  config: SolanaPaymasterRuntimeConfig
): SolanaPaymasterService => {
  const rpc = createSolanaRpc(config.rpcUrl);
  let advertise = true;

  const handleInProcess = async (
    method: string,
    params: unknown,
    id: unknown
  ): Promise<{ status: number; body: unknown }> => {
    switch (method) {
      case "getConfig":
        return ok(id, buildFreeConfig(config));
      case "getPayerSigner":
        return ok(id, { signer_address: config.payerAddress, payment_address: config.payerAddress });
      case "getBlockhash": {
        const { value } = await rpc.getLatestBlockhash().send();
        return ok(id, { blockhash: value.blockhash });
      }
      case "getSupportedTokens":
        return ok(id, { tokens: [...config.feeTokens] });
      case "estimateTransactionFee": {
        const transaction = readTransactionParam(params);
        if (transaction === null) {
          return ok(id, jsonRpcErrorBody(-32602, "params.transaction must be a base64 string"));
        }
        const decoded = decodeWireTransaction(transaction);
        if (decoded === null) {
          return ok(id, jsonRpcErrorBody(-32602, "transaction does not decode as a wire transaction"));
        }
        const feeInLamports = await estimateFeeLamports(rpc, decoded);
        // Dev sponsorship is Kora's `free` pricing model: the fee-token charge is zero.
        return ok(id, {
          fee_in_lamports: feeInLamports,
          fee_in_token: 0,
          payment_address: config.payerAddress,
          signer_pubkey: config.payerAddress
        });
      }
      case "signTransaction":
      case "signAndSendTransaction": {
        const transaction = readTransactionParam(params);
        if (transaction === null) {
          return ok(id, jsonRpcErrorBody(-32602, "params.transaction must be a base64 string"));
        }
        const decoded = decodeWireTransaction(transaction);
        if (decoded === null) {
          return ok(id, jsonRpcErrorBody(-32602, "transaction does not decode as a wire transaction"));
        }

        // Only co-sign transactions that name THIS payer as fee payer — a request naming anyone
        // else is malformed at best and a signing oracle at worst.
        const feePayer = feePayerOf(decoded);
        if (feePayer !== config.payerAddress) {
          return ok(
            id,
            jsonRpcErrorBody(
              -32602,
              `transaction fee payer (${feePayer}) is not this paymaster (${config.payerAddress})`
            )
          );
        }

        const signer = await createKeyPairSignerFromPrivateKeyBytes(config.payerPrivateKey);
        const [payerSignatures] = await signer.signTransactions([decoded as SignableTransaction]);
        const signed = {
          ...decoded,
          signatures: { ...decoded.signatures, ...payerSignatures }
        };
        const signedWire = getBase64EncodedWireTransaction(signed);

        if (method === "signTransaction") {
          return ok(id, { signed_transaction: signedWire, signer_pubkey: config.payerAddress });
        }

        const signature = await rpc.sendTransaction(signedWire, { encoding: "base64" }).send();
        return ok(id, {
          signature,
          signed_transaction: signedWire,
          signer_pubkey: config.payerAddress
        });
      }
      default:
        return ok(id, jsonRpcErrorBody(-32601, `Method not found: ${method}`));
    }
  };

  return {
    configured: true,
    get advertise() {
      return advertise;
    },
    payerAddress: config.payerAddress,
    paymasterPath: SOLANA_PAYMASTER_PATH,
    feeTokens: [...config.feeTokens],
    rpcUrl: config.rpcUrl,

    async bootstrap() {
      const balance = await rpc.getBalance(solanaAddress(config.payerAddress)).send();
      if (balance.value === 0n) {
        console.warn(
          `[aa:solana]: payer ${config.payerAddress} has zero balance — sponsorship will fail until funded; not advertising`
        );
        advertise = false;
        return;
      }
      console.log(
        `[aa:solana]: fee payer ${config.payerAddress} ready (${balance.value} lamports${config.koraUrl === null ? ", in-process signer" : `, proxying ${config.koraUrl}`})`
      );
    },

    async handleRpc(body) {
      const request = parseJsonRpc(body);
      if (request === null) {
        return { status: 400, body: jsonRpcError(-32600, "Invalid JSON-RPC request", null) };
      }
      const { method, params, id } = request;

      if (!(KORA_METHOD_ALLOWLIST as readonly string[]).includes(method)) {
        return { status: 200, body: jsonRpcError(-32601, `Method not allowed: ${method}`, id) };
      }

      if (config.koraUrl !== null) {
        return proxyKoraRpc(config.koraUrl, body);
      }

      try {
        return await handleInProcess(method, params, id);
      } catch (error) {
        console.error(`[aa:solana]: ${method} failed:`, error);
        return { status: 500, body: jsonRpcError(-32000, "Solana paymaster request failed", id) };
      }
    }
  };
};

const ok = (id: unknown, result: unknown): { status: number; body: unknown } =>
  isJsonRpcErrorBody(result)
    ? { status: 200, body: { jsonrpc: "2.0", error: result.error, id } }
    : { status: 200, body: { jsonrpc: "2.0", result, id } };

const JSON_RPC_ERROR_MARK = Symbol.for("livestreak.jsonRpcError");

const jsonRpcErrorBody = (code: number, message: string) => ({
  [JSON_RPC_ERROR_MARK]: true,
  error: { code, message }
});

const isJsonRpcErrorBody = (value: unknown): value is { error: { code: number; message: string } } =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<PropertyKey, unknown>)[JSON_RPC_ERROR_MARK] === true;

const jsonRpcError = (code: number, message: string, id: unknown) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id
});

const parseJsonRpc = (
  body: unknown
): { method: string; params: unknown; id: unknown } | null => {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const request = body as { method?: unknown; params?: unknown; id?: unknown };
  if (typeof request.method !== "string" || request.method.length === 0) {
    return null;
  }
  return { method: request.method, params: request.params, id: request.id ?? null };
};

const readJsonRpcId = (body: unknown): unknown =>
  body !== null && typeof body === "object" ? ((body as { id?: unknown }).id ?? null) : null;

const readTransactionParam = (params: unknown): string | null => {
  if (params === null || typeof params !== "object") {
    return null;
  }
  const transaction = (params as { transaction?: unknown }).transaction;
  return typeof transaction === "string" && transaction.length > 0 ? transaction : null;
};

type DecodedWireTransaction = ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
type SignableTransaction = Parameters<
  Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>["signTransactions"]
>[0][number];

const decodeWireTransaction = (base64Wire: string): DecodedWireTransaction | null => {
  try {
    return getTransactionDecoder().decode(getBase64Encoder().encode(base64Wire));
  } catch {
    return null;
  }
};

const feePayerOf = (transaction: DecodedWireTransaction): string => {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  return String(compiled.staticAccounts[0] ?? "");
};

const estimateFeeLamports = async (
  rpc: ReturnType<typeof createSolanaRpc>,
  transaction: DecodedWireTransaction
): Promise<number> => {
  try {
    const base64Message = getBase64Decoder().decode(transaction.messageBytes);
    const fee = await rpc.getFeeForMessage(base64Message as never).send();
    return fee.value === null ? 5_000 : Number(fee.value);
  } catch {
    return 5_000;
  }
};

const proxyKoraRpc = async (
  koraUrl: string,
  body: unknown
): Promise<{ status: number; body: unknown }> => {
  try {
    const response = await fetch(koraUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return {
      status: 502,
      body: jsonRpcError(-32000, `kora upstream unreachable: ${String(error)}`, readJsonRpcId(body))
    };
  }
};

const buildFreeConfig = (config: SolanaPaymasterRuntimeConfig) => ({
  enabled_methods: Object.fromEntries(
    KORA_METHOD_ALLOWLIST.map((method) => [toSnakeCase(method), true])
  ),
  fee_payers: [config.payerAddress],
  validation_config: {
    allowed_programs: [],
    allowed_spl_paid_tokens: [...config.feeTokens],
    allowed_tokens: [...config.feeTokens],
    disallowed_accounts: [],
    max_allowed_lamports: 0,
    max_signatures: 16,
    price: { type: "free" },
    price_source: "Mock"
  }
});

const toSnakeCase = (value: string): string =>
  value.replace(/[A-Z]/gu, (char) => `_${char.toLowerCase()}`);

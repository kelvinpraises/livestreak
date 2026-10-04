import { decodeErrorResult, type Hex, parseAbi } from "viem";

// --- exports ---

const EXECUTION_FAILED_SELECTOR = "0xacfdb444";
const ERROR_STRING_SELECTOR = "0x08c379a0";
const PANIC_SELECTOR = "0x4e487b71";

const ENTRY_POINT_ERRORS = parseAbi([
  "error FailedOp(uint256 opIndex, string reason)",
  "error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)",
  "error CallPhaseReverted(bytes reason)",
  "error Error(string)",
  "error Panic(uint256)",
  "error ExecutionFailed()"
]);

const PANIC_CODES: Readonly<Record<number, string>> = {
  1: "assert(false)",
  17: "arithmetic overflow/underflow",
  18: "divide by zero",
  33: "invalid enum value",
  34: "storage byte array that is incorrectly encoded",
  49: ".pop() on an empty array",
  50: "array out-of-bounds or negative index",
  65: "memory overflow",
  81: "zero-initialized variable of internal function type"
};

/** Decode a revert payload (EntryPoint wrapper, Error(string), Panic, Safe ExecutionFailed). */
export const decodeRevertData = (data: Hex): string | null => {
  if (data.length < 10) {
    return null;
  }

  const selector = data.slice(0, 10).toLowerCase();

  if (selector === EXECUTION_FAILED_SELECTOR) {
    return "ExecutionFailed() (Safe4337 masked inner revert)";
  }

  if (selector === ERROR_STRING_SELECTOR || selector === PANIC_SELECTOR) {
    return decodePrimitiveRevert(data);
  }

  try {
    const decoded = decodeErrorResult({ abi: ENTRY_POINT_ERRORS, data });
    switch (decoded.errorName) {
      case "FailedOp":
        return String(decoded.args[1]);
      case "FailedOpWithRevert": {
        const reason = String(decoded.args[1]);
        const inner = decodeRevertData(decoded.args[2] as Hex);
        return inner === null ? reason : `${reason} — ${inner}`;
      }
      case "CallPhaseReverted": {
        const inner = decodeRevertData(decoded.args[0] as Hex);
        return inner === null ? "CallPhaseReverted" : inner;
      }
      case "Error":
        return String(decoded.args[0]);
      case "Panic": {
        const code = Number(decoded.args[0]);
        return `Panic(${PANIC_CODES[code] ?? code})`;
      }
      case "ExecutionFailed":
        return "ExecutionFailed() (Safe4337 masked inner revert)";
      default:
        return null;
    }
  } catch {
    return decodePrimitiveRevert(data);
  }
};

/** Enrich bundler JSON-RPC error messages with decoded inner revert when possible. */
export const enrichBundlerJsonRpcError = (body: unknown): unknown => {
  if (body === null || typeof body !== "object" || !("error" in body)) {
    return body;
  }

  const envelope = body as { error?: unknown };
  if (envelope.error === null || typeof envelope.error !== "object") {
    return body;
  }

  const rpcError = envelope.error as { message?: unknown; data?: unknown };
  if (typeof rpcError.message !== "string") {
    return body;
  }

  const decoded = findDecodedRevert(rpcError.message, rpcError.data);
  if (decoded === null || messageAlreadyContains(rpcError.message, decoded)) {
    return body;
  }

  const label = decoded.includes("ExecutionFailed()") ? "innerRevert" : "reason";
  return {
    ...envelope,
    error: {
      ...rpcError,
      message: `${rpcError.message} ${label}: ${decoded}`
    }
  };
};

export const BUNDLER_REVERT_DECODE_METHODS: ReadonlySet<string> = new Set([
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation"
]);

// --- helpers ---

const decodePrimitiveRevert = (data: Hex): string | null => {
  try {
    const decoded = decodeErrorResult({
      abi: parseAbi(["error Error(string)", "error Panic(uint256)"]),
      data
    });
    if (decoded.errorName === "Error") {
      return String(decoded.args[0]);
    }
    if (decoded.errorName === "Panic") {
      const code = Number(decoded.args[0]);
      return `Panic(${PANIC_CODES[code] ?? code})`;
    }
  } catch {
    return null;
  }
  return null;
};

const findDecodedRevert = (message: string, data: unknown): string | null => {
  const fromData = extractHex(data);
  if (fromData !== undefined) {
    const decoded = decodeRevertData(fromData);
    if (decoded !== null) {
      return decoded;
    }
  }

  for (const hex of extractHexCandidates(message)) {
    const decoded = decodeRevertData(hex);
    if (decoded !== null) {
      return decoded;
    }
  }

  const reasonTail = message.match(/reason:\s*(.+)$/iu)?.[1]?.trim();
  if (reasonTail !== undefined && reasonTail.length > 0 && !reasonTail.startsWith("0x")) {
    const aaInner = reasonTail.match(/AA\d+\s+reverted\s+(.+)$/iu)?.[1]?.trim();
    if (aaInner !== undefined && aaInner.length > 0 && !aaInner.startsWith("0x")) {
      return null;
    }
  }

  return null;
};

const extractHex = (value: unknown): Hex | undefined => {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return undefined;
  }
  return value as Hex;
};

const extractHexCandidates = (message: string): readonly Hex[] => {
  const matches = message.match(/0x[a-fA-F0-9]+/gu) ?? [];
  return [...matches].reverse() as Hex[];
};

const messageAlreadyContains = (message: string, decoded: string): boolean => {
  const normalized = message.toLowerCase();
  const needle = decoded.toLowerCase();
  if (normalized.includes(needle)) {
    return true;
  }
  if (needle.includes("executionfailed()") && normalized.includes("executionfailed")) {
    return true;
  }
  return normalized.includes(`reason: ${needle}`) || normalized.includes(`innerrevert: ${needle}`);
};

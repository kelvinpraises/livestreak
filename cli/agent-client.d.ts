// Public declarations for `@livestreak/cli/agent-client`.
//
// Self-contained ON PURPOSE: the tarball ships only this file plus the two JS
// bundles, so it must not import workspace modules or registry types a clean
// consumer does not install. Mirror any surface change here together with
// `src/agent-client.ts`; `test/packed-entry.test.ts` pins export names and
// two-way type parity at check time.

export type CapabilityScope = `${string}:${string}` | `${string}:${string}:${string}` | "*";

export type ConsolePackage = "observe" | "options" | "bookmaker" | "steward";

export type FunctionNodeKind = "group" | "action";

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "union"
  | "unknown";

export interface JsonSchemaProperty {
  readonly name: string;
  readonly value: JsonSchema;
  readonly help: string;
}

export interface JsonSchema {
  readonly type: JsonSchemaType;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly format?: "bigint";
  readonly values?: readonly string[];
  readonly properties?: readonly JsonSchemaProperty[];
  readonly items?: JsonSchema;
  readonly variants?: readonly JsonSchema[];
}

export interface FunctionDescriptorTarget {
  readonly kind: string;
  readonly marketId?: string;
  readonly vaultId?: string;
  readonly side?: string;
  readonly tokenId?: string;
}

export interface FunctionDescriptor {
  readonly id: string;
  readonly parentId?: string;
  readonly package: ConsolePackage;
  readonly name: string;
  readonly label: string;
  readonly scope: CapabilityScope;
  readonly target?: FunctionDescriptorTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly inputSchema?: JsonSchema;
  readonly visible?: boolean;
  readonly order?: number;
  readonly nodeKind?: FunctionNodeKind;
}

export type RemoteDriveTarget = "observe" | "options" | "steward" | "bookmaker";

export interface RemoteUiClientOptions {
  readonly hostBaseUrl: string;
  readonly sessionId: string;
  readonly pairingPassword: string;
  readonly log?: (line: string) => void;
}

/** Shared, provider-neutral judging terms. Canonical bytes have no vault-ID dependency. */

export interface NumericEvaluation {
  readonly kind: "numeric-threshold";
  readonly sourceId: string;
  readonly field: string;
  readonly units: string;
  readonly comparator: ">" | ">=" | "<" | "<=";
  readonly threshold: string;
  readonly tie: "yes" | "no";
}
export interface VaultMandate {
  readonly version: "livestreak-mandate/1";
  readonly chainId: string;
  readonly marketId: string;
  readonly question: string;
  readonly yesMeaning: string;
  readonly noMeaning: string;
  readonly method: "deterministic" | "discretionary" | "mixed";
  readonly evaluation:
    | NumericEvaluation
    | { readonly kind: "rubric"; readonly rubric: string }
    | {
        readonly kind: "mixed";
        readonly rubric: string;
        readonly checks: readonly NumericEvaluation[];
      };
  readonly evidence: readonly {
    readonly sourceId: string;
    readonly kind: "data" | "video" | "record" | "testimony";
    readonly description: string;
  }[];
  readonly authority: "market-designated-steward";
  readonly authorityChanges: "registry-authority-may-change";
  readonly fundingClose: number;
  readonly decisionStart: number;
  readonly decisionEnd: number;
  readonly missingEvidence: {
    readonly deadline: number;
    readonly treatment: "unresolved-escalate-no-guaranteed-refund";
    readonly procedure: string;
  };
  readonly ambiguityProcedure: string;
}
export interface BoundVaultTerms {
  readonly chainId: string;
  readonly marketId: string;
  readonly vaultId: string;
  readonly question: string;
  readonly commitment: string;
  readonly fundingClose: number;
}
export interface VerifiedVaultMandate {
  readonly terms: BoundVaultTerms;
  readonly mandate: VaultMandate;
}

export interface RemoteCallOutcome {
  readonly ok: boolean;
  readonly result?: {
    readonly txId?: string;
    readonly tokenId?: string;
    readonly commitment?: string;
    readonly terms?: BoundVaultTerms;
    readonly mandate?: VaultMandate;
    readonly recordDigest?: string;
    readonly confirmationDigest?: string;
    readonly status?: string;
    readonly reason?: string;
  };
  readonly error?: string;
}

export interface RemoteUiClient {
  connect(): Promise<void>;
  /** `id` is the optional cell-qualified descriptor id; authz stays keyed on the bare action. */
  call(
    target: RemoteDriveTarget,
    action: string,
    args?: unknown,
    id?: string,
  ): Promise<RemoteCallOutcome>;
  boards(): Readonly<Record<string, unknown>>;
  /** Scope-filtered function catalog last pushed by Host (empty until `ready`). */
  functions(): ReadonlyArray<FunctionDescriptor>;
  close(): void;
}

export interface IngestDriveInput {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Loopback TCP port the bot POSTs to (server default 48710). */
  readonly port?: number;
  /** Ingest path the bot POSTs to (server default "/frames"). */
  readonly path?: string;
  /** Changing frames the pump POSTs until the drive ends. Yield on a bounded interval. */
  readonly frames: AsyncIterable<Uint8Array>;
}

export interface RemoteDriveInput {
  readonly sessionId: string;
  readonly pairingPassword: string;
  /** Steward-role session: on-chain resolution is authorized to the registered steward address. */
  readonly stewardSessionId?: string;
  readonly stewardPairingPassword?: string;
  readonly hostUrl?: string;
  readonly settingsPath?: string;
  readonly marketId?: string;
  readonly observeTitle?: string;
  readonly fundDeposit?: string;
  readonly resolveOutcome?: string;
  readonly resolveReason?: string;
  readonly resolveEvidenceJson?: string;
  readonly observeOnly?: boolean;
  /** File capture path for the direct-video lane (exclusive with `ingest`). */
  readonly directVideoPath?: string;
  readonly directPort?: number;
  /** One total budget shared by announce + watch proof (default 30s). */
  readonly directTimeoutMs?: number;
  /** Bot-fed ingest lane; needs `bridge:action:captureKind` in the grant. */
  readonly ingest?: IngestDriveInput;
  /** Media-only proof: vault + fund + re-probe, then return without steward legs. Requires `ingest`. */
  readonly mediaOnly?: boolean;
  readonly mandate?: VaultMandate;
  readonly mandateForMarket?: (marketId: string) => VaultMandate | Promise<VaultMandate>;
  readonly operationId?: string;
  readonly log?: (line: string) => void;
}

export interface RemoteDriveStep {
  readonly target: RemoteDriveTarget;
  readonly action: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface IngestPump {
  /** Resolves when the pump loop exits (never rejects; failures are recorded). */
  readonly done: Promise<void>;
  readonly stop: () => void;
  readonly posted: () => number;
  readonly dropped: () => number;
  readonly failure: () => unknown;
  /** True once the frame iterable ended naturally. */
  readonly exhausted: () => boolean;
}

export interface RemoteDriveResult {
  readonly marketId?: string;
  readonly steps: readonly RemoteDriveStep[];
  /** Bot-fed pump, still posting on return. Stop it after truthful end. Absent for file/no-video drives. */
  readonly pump?: IngestPump;
}

export declare const createRemoteUiClient: (opts: RemoteUiClientOptions) => RemoteUiClient;

/** Stable alias: one name for docs and examples to use. */
export declare const createAgentClient: (opts: RemoteUiClientOptions) => RemoteUiClient;

export declare const classifyRemoteError: (message: string) => string;

export declare const runRemoteDrive: (
  input: RemoteDriveInput,
) => Promise<RemoteDriveResult>;

/** Proof-only changing frames (counter bytes, rgba-sized). */
export declare function generateCounterFrames(
  width: number,
  height: number,
  count: number,
): AsyncGenerator<Uint8Array>;

/** Post-start drive failure that hands the still-posting pump to the caller. */
export declare class IngestPumpError extends Error {
  readonly pump: IngestPump;
  constructor(message: string, pump: IngestPump);
}

import { readFile } from "node:fs/promises";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { createHostClient } from "../adapters/host.js";
import {
  defaultInitDocPath,
  loadInitDoc,
  saveInitDoc,
  type LivestreakInitDoc
} from "../prefs/init-doc.js";

// ── Deploy file shape (scopes from packages/contracts/chains/evm/deployments/*.json) ──

interface AaContracts {
  readonly entryPoint: `0x${string}`;
  readonly safeSingleton: `0x${string}`;
  readonly safeProxyFactory: `0x${string}`;
  readonly safeModuleSetup: `0x${string}`;
  readonly safe4337Module: `0x${string}`;
  readonly multiSend: `0x${string}`;
  readonly multiSendCallOnly: `0x${string}`;
  readonly fallbackHandler: `0x${string}`;
  readonly signMessageLib: `0x${string}`;
  readonly createCall: `0x${string}`;
  readonly simulateTxAccessor: `0x${string}`;
}

interface StreamingContracts {
  readonly dripsStreaming: `0x${string}`;
}

interface ProtocolContracts {
  readonly marketRegistry: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly lvstToken: `0x${string}`;
  readonly treasury: `0x${string}`;
  readonly stewardRegistry: `0x${string}`;
}

interface WireContracts {
  readonly vaultDriver: `0x${string}`;
  readonly marketDriverProxy: `0x${string}`;
}

interface DeployScope<C> {
  readonly contracts: C;
}

interface DeployFile {
  readonly chainId: number;
  readonly rpc: string;
  readonly scopes: {
    readonly aa: DeployScope<AaContracts>;
    readonly streaming: DeployScope<StreamingContracts>;
    readonly protocol: DeployScope<ProtocolContracts>;
    readonly wire: DeployScope<WireContracts>;
  };
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

const addr = (value: unknown, label: string): `0x${string}` => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed EVM address, got ${JSON.stringify(value)}`);
  }
  return value.toLowerCase() as `0x${string}`;
};

const str = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const num = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
};

const parseDeployFile = (raw: unknown): DeployFile => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("deployment file must be a JSON object");
  }

  const r = raw as Record<string, unknown>;
  const chainId = num(r["chainId"], "chainId");
  const rpc = str(r["rpc"], "rpc");

  const scopes = r["scopes"];
  if (typeof scopes !== "object" || scopes === null) {
    throw new Error("deployment file missing scopes");
  }

  const sc = scopes as Record<string, unknown>;
  const aa = parseScope<AaContracts>(sc["aa"], "scopes.aa", parseAaContracts);
  const streaming = parseScope<StreamingContracts>(
    sc["streaming"],
    "scopes.streaming",
    parseStreamingContracts
  );
  const protocol = parseScope<ProtocolContracts>(
    sc["protocol"],
    "scopes.protocol",
    parseProtocolContracts
  );
  const wire = parseScope<WireContracts>(sc["wire"], "scopes.wire", parseWireContracts);

  return { chainId, rpc, scopes: { aa, streaming, protocol, wire } };
};

const parseScope = <C>(
  value: unknown,
  label: string,
  parseContracts: (c: Record<string, unknown>, prefix: string) => C
): DeployScope<C> => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} is missing or not an object`);
  }

  const s = value as Record<string, unknown>;
  const contracts = s["contracts"];
  if (typeof contracts !== "object" || contracts === null) {
    throw new Error(`${label}.contracts is missing or not an object`);
  }

  return { contracts: parseContracts(contracts as Record<string, unknown>, `${label}.contracts`) };
};

const parseAaContracts = (c: Record<string, unknown>, p: string): AaContracts => ({
  entryPoint: addr(c["entryPoint"], `${p}.entryPoint`),
  safeSingleton: addr(c["safeSingleton"], `${p}.safeSingleton`),
  safeProxyFactory: addr(c["safeProxyFactory"], `${p}.safeProxyFactory`),
  safeModuleSetup: addr(c["safeModuleSetup"], `${p}.safeModuleSetup`),
  safe4337Module: addr(c["safe4337Module"], `${p}.safe4337Module`),
  multiSend: addr(c["multiSend"], `${p}.multiSend`),
  multiSendCallOnly: addr(c["multiSendCallOnly"], `${p}.multiSendCallOnly`),
  fallbackHandler: addr(c["fallbackHandler"], `${p}.fallbackHandler`),
  signMessageLib: addr(c["signMessageLib"], `${p}.signMessageLib`),
  createCall: addr(c["createCall"], `${p}.createCall`),
  simulateTxAccessor: addr(c["simulateTxAccessor"], `${p}.simulateTxAccessor`)
});

const parseStreamingContracts = (c: Record<string, unknown>, p: string): StreamingContracts => ({
  dripsStreaming: addr(c["dripsStreaming"], `${p}.dripsStreaming`)
});

const parseProtocolContracts = (c: Record<string, unknown>, p: string): ProtocolContracts => ({
  marketRegistry: addr(c["marketRegistry"], `${p}.marketRegistry`),
  vault: addr(c["vault"], `${p}.vault`),
  lvstToken: addr(c["lvstToken"], `${p}.lvstToken`),
  treasury: addr(c["treasury"], `${p}.treasury`),
  stewardRegistry: addr(c["stewardRegistry"], `${p}.stewardRegistry`)
});

const parseWireContracts = (c: Record<string, unknown>, p: string): WireContracts => ({
  vaultDriver: addr(c["vaultDriver"], `${p}.vaultDriver`),
  marketDriverProxy: addr(c["marketDriverProxy"], `${p}.marketDriverProxy`)
});

// ── Core logic ────────────────────────────────────────────────────────────────

export interface RunInitInput {
  readonly deploymentPath: string;
  readonly hostUrl: string;
  readonly network?: "testnet" | "mainnet";
  readonly outPath?: string;
}

export const runInit = async (input: RunInitInput): Promise<LivestreakInitDoc> => {
  const outPath = input.outPath ?? defaultInitDocPath;

  const raw = await readFile(input.deploymentPath, "utf8").catch(() => {
    throw new Error(`Cannot read deployment file: ${input.deploymentPath}`);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed JSON in deployment file: ${input.deploymentPath}`);
  }

  const deploy = parseDeployFile(parsed);

  const { aa, streaming, protocol, wire } = deploy.scopes;
  const chainId = deploy.chainId;
  const rpc = deploy.rpc;
  const hostUrl = input.hostUrl.replace(/\/$/, "");
  const host = createHostClient(hostUrl);

  // AA bundler/paymaster routes are keyed by the host's routeKey (a chain NAME, e.g. "local"),
  // NOT the chainId — so read the paths from /aa/descriptor, matched by chainId.
  const aaDescriptor = await host.getAaDescriptor().catch((err: unknown) => {
    throw new Error(`Cannot reach host /aa/descriptor at ${hostUrl}: ${String(err)}`);
  });
  const aaChain = aaDescriptor.chains.find((c) => c.chainId === chainId);
  if (aaChain === undefined) {
    throw new Error(
      `Host /aa/descriptor has no chain with chainId ${chainId} (advertises: ${aaDescriptor.chains.map((c) => c.chainId).join(", ") || "none"})`
    );
  }
  const bundlerUrl = `${hostUrl}${aaChain.bundlerPath}`;
  // HOST.H5: the paymaster route is per-chain (`/aa/paymaster/:routeKey`), symmetric with
  // bundlerPath. Read the per-chain `chains[].paymasterPath`; fall back to the top-level
  // `paymasterPath` only for older hosts that don't yet emit the per-chain field.
  const perChainPaymasterPath = (aaChain as { paymasterPath?: string }).paymasterPath;
  const paymasterUrl = `${hostUrl}${perChainPaymasterPath ?? aaDescriptor.paymasterPath}`;

  // walrus.network: --network flag wins; otherwise read the main /descriptor.
  let walrusNetwork = input.network;
  if (walrusNetwork === undefined) {
    const descriptor = await host.getDescriptor().catch((err: unknown) => {
      throw new Error(
        `Cannot reach host /descriptor at ${hostUrl} to read walrus.network — pass --network explicitly. ${String(err)}`
      );
    });
    const net = descriptor.walrus?.network;
    if (net !== "testnet" && net !== "mainnet") {
      throw new Error(
        `Host /descriptor returned unexpected walrus.network: ${JSON.stringify(net)}. Pass --network explicitly.`
      );
    }
    walrusNetwork = net;
  }

  const doc: LivestreakInitDoc = {
    chain: {
      rpc,
      chainId,
      marketRegistry: protocol.contracts.marketRegistry
    },
    host: {
      url: hostUrl,
      walrusNetwork
    },
    options: {
      marketRegistry: protocol.contracts.marketRegistry,
      vault: protocol.contracts.vault,
      marketDriver: wire.contracts.marketDriverProxy,
      stewardRegistry: protocol.contracts.stewardRegistry,
      treasury: protocol.contracts.treasury,
      lvstToken: protocol.contracts.lvstToken,
      dripsStreaming: streaming.contracts.dripsStreaming,
      vaultDriver: wire.contracts.vaultDriver
    },
    wallet: {
      config: {
        chainId,
        provider: rpc,
        bundlerUrl,
        paymasterUrl,
        isSponsored: true,
        useNativeCoins: false,
        entryPointAddress: aa.contracts.entryPoint,
        safe4337ModuleAddress: aa.contracts.safe4337Module,
        safeModulesSetupAddress: aa.contracts.safeModuleSetup,
        safeModulesVersion: "0.3.0",
        contractNetworks: {
          [String(chainId)]: {
            safeSingletonAddress: aa.contracts.safeSingleton,
            safeProxyFactoryAddress: aa.contracts.safeProxyFactory,
            multiSendAddress: aa.contracts.multiSend,
            multiSendCallOnlyAddress: aa.contracts.multiSendCallOnly,
            fallbackHandlerAddress: aa.contracts.fallbackHandler,
            signMessageLibAddress: aa.contracts.signMessageLib,
            createCallAddress: aa.contracts.createCall,
            simulateTxAccessorAddress: aa.contracts.simulateTxAccessor
          }
        }
      }
    }
  };

  await saveInitDoc(outPath, doc);
  // Confirm round-trip: loadInitDoc must accept what we just wrote.
  await loadInitDoc(outPath);

  return doc;
};

// ── Command ──────────────────────────────────────────────────────────────────

const deploymentOpt = Options.file("deployment").pipe(
  Options.withDescription("Path to the contracts deployment JSON (e.g. deployments/localhost.json)")
);

const hostOpt = Options.text("host").pipe(
  Options.withDescription("Base URL of the livestreak host (e.g. http://localhost:4848)")
);

const networkOpt = Options.choice("network", ["testnet", "mainnet"]).pipe(
  Options.withDescription("Walrus network — inferred from host /descriptor when omitted"),
  Options.optional
);

const outOpt = Options.file("out").pipe(
  Options.withDescription("Output path for livestreak.json"),
  Options.optional
);

export const renderInitResult = (doc: LivestreakInitDoc, outPath: string): string =>
  [
    "livestreak init — complete",
    "",
    `written:         ${outPath}`,
    `chain.rpc:       ${doc.chain.rpc}`,
    `chain.chainId:   ${doc.chain.chainId}`,
    `marketRegistry:  ${doc.chain.marketRegistry}`,
    `marketDriver:    ${doc.options.marketDriver}`,
    `vaultDriver:     ${doc.options.vaultDriver}`,
    `walrus:          ${doc.host.walrusNetwork}`,
    `host:            ${doc.host.url}`
  ].join("\n");

export const initCommand = Command.make(
  "init",
  {
    deployment: deploymentOpt,
    host: hostOpt,
    network: networkOpt,
    out: outOpt
  },
  ({ deployment, host, network, out }) => {
    const outPath = Option.isSome(out) ? out.value : defaultInitDocPath;
    return Effect.tryPromise({
      try: () =>
        runInit({
          deploymentPath: deployment,
          hostUrl: host,
          ...(Option.isSome(network) ? { network: network.value } : {}),
          outPath
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((doc) => Console.log(renderInitResult(doc, outPath))));
  }
);

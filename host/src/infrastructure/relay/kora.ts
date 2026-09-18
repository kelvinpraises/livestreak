import { spawn, type ChildProcess } from "node:child_process";
import { readOptionalEnv } from "../../config/env.js";

// --- exports ---

// Spawned-sidecar shape for the Solana paymaster: run a real kora-rpc node and let the
// solana-paymaster service proxy to it (mirrors the alto bundler child). Enabled with
// LIVESTREAK_KORA_ENABLED=1 + LIVESTREAK_KORA_BIN (path to the kora-rpc binary) +
// LIVESTREAK_KORA_CONFIG (kora.toml). Deploy note: the Dockerfile does NOT ship a kora
// binary — prod either COPYs a prebuilt one or points LIVESTREAK_KORA_URL at an external node.

export interface KoraSpawnConfig {
  readonly binaryPath: string;
  readonly configPath: string;
  readonly rpcUrl: string;
  /** base58 or path-based key material, passed via env — never argv (H4). */
  readonly signerKey: string;
  readonly port: number;
}

const DEFAULT_KORA_PORT = 8087;

let instance: { port: number; child: ChildProcess } | null = null;

export const getKoraUrl = (): string | null =>
  instance === null ? null : `http://127.0.0.1:${instance.port}`;

export const readKoraSpawnConfig = (rpcUrl: string, signerKey: string): KoraSpawnConfig | null => {
  if (readOptionalEnv("LIVESTREAK_KORA_ENABLED") !== "1") {
    return null;
  }
  const binaryPath = readOptionalEnv("LIVESTREAK_KORA_BIN");
  const configPath = readOptionalEnv("LIVESTREAK_KORA_CONFIG");
  if (binaryPath === null || configPath === null) {
    console.warn(
      "[kora]: LIVESTREAK_KORA_ENABLED=1 but LIVESTREAK_KORA_BIN/LIVESTREAK_KORA_CONFIG are unset — falling back to the in-process signer"
    );
    return null;
  }
  const portRaw = readOptionalEnv("LIVESTREAK_KORA_PORT");
  const port = portRaw === null ? DEFAULT_KORA_PORT : Number.parseInt(portRaw, 10);
  return {
    binaryPath,
    configPath,
    rpcUrl,
    signerKey,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_KORA_PORT
  };
};

export const startKora = async (config: KoraSpawnConfig): Promise<string> => {
  if (instance !== null) {
    return `http://127.0.0.1:${instance.port}`;
  }

  console.log(`[kora]: starting kora-rpc on port ${config.port}`);
  const child = spawn(
    config.binaryPath,
    ["--config", config.configPath, "--port", String(config.port), "--rpc-url", config.rpcUrl],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // kora-rpc reads its signer from env (KORA_PRIVATE_KEY), never argv (H4).
        KORA_PRIVATE_KEY: config.signerKey
      }
    }
  );

  instance = { port: config.port, child };

  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[kora]: ${data.toString().trim()}`);
  });
  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[kora]: ${data.toString().trim()}`);
  });
  child.on("exit", (code) => {
    console.error(`[kora]: exited with code ${code}`);
    instance = null;
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  return `http://127.0.0.1:${config.port}`;
};

process.on("exit", () => {
  if (instance !== null) {
    console.log("[kora]: stopping kora-rpc");
    instance.child.kill();
  }
});

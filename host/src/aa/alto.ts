import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- exports ---

export interface AltoConfig {
  readonly entryPointAddress: string;
  readonly rpcUrl: string;
  readonly executorPrivateKey: string;
  readonly port: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(__dirname, "../..");

const BASE_PORT = 4337;
let nextPort = BASE_PORT;
const instances = new Map<string, number>();
const processes = new Map<string, ChildProcess>();

export const getAltoPort = (chainName: string): number | null => instances.get(chainName) ?? null;

export const assignPort = (chainName: string): number => {
  const existing = instances.get(chainName);
  if (existing !== undefined) {
    return existing;
  }

  const port = nextPort++;
  instances.set(chainName, port);
  return port;
};

export const startAlto = async (chainName: string, config: AltoConfig): Promise<void> => {
  if (instances.has(chainName)) {
    return;
  }

  const port = assignPort(chainName);
  console.log(`[alto]: starting bundler for ${chainName} on port ${port}`);

  const child = spawn(
    "npx",
    [
      "alto",
      "--entrypoints",
      config.entryPointAddress,
      "--rpc-url",
      config.rpcUrl,
      "--executor-private-keys",
      config.executorPrivateKey,
      "--utility-private-key",
      config.executorPrivateKey,
      "--port",
      String(port),
      "--safe-mode",
      "false",
      "--no-profit-bundling",
      "--log-level",
      "info"
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: HOST_ROOT,
      env: { ...process.env }
    }
  );

  processes.set(chainName, child);

  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[alto:${chainName}]: ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[alto:${chainName}]: ${data.toString().trim()}`);
  });

  child.on("exit", (code) => {
    console.error(`[alto]: bundler for ${chainName} exited with code ${code}`);
    instances.delete(chainName);
    processes.delete(chainName);
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`[alto]: bundler for ${chainName} ready on port ${port}`);
};

process.on("exit", () => {
  for (const [name, child] of processes) {
    console.log(`[alto]: stopping bundler for ${name}`);
    child.kill();
  }
});

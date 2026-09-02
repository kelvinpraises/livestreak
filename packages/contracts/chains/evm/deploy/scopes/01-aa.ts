import type { Address, Hex } from "viem";
import { readFileSync } from "fs";
import { join } from "path";
import {
  artifactExists,
  deployFromArtifact,
  isDeployed,
  type ScopeResult,
  DETERMINISTIC_DEPLOYER
} from "../utils.js";

const ENTRYPOINT_SALT = "0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3" as Hex;

const KNOWN_ADDRESSES: Record<string, Address> = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safe4337Module: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  safeModuleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB3b47"
};

const ARTIFACTS: Record<string, { path: string }> = {
  safeSingleton: { path: "out/Safe.sol/Safe.json" },
  safeProxyFactory: { path: "out/SafeProxyFactory.sol/SafeProxyFactory.json" },
  safe4337Module: { path: "out/Safe4337Module.sol/Safe4337Module.json" },
  safeModuleSetup: { path: "out/SafeModuleSetup.sol/SafeModuleSetup.json" },
  multiSend: { path: "out/MultiSend.sol/MultiSend.json" },
  multiSendCallOnly: { path: "out/MultiSendCallOnly.sol/MultiSendCallOnly.json" },
  fallbackHandler: { path: "out/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json" },
  signMessageLib: { path: "out/SignMessageLib.sol/SignMessageLib.json" },
  createCall: { path: "out/CreateCall.sol/CreateCall.json" },
  simulateTxAccessor: { path: "out/SimulateTxAccessor.sol/SimulateTxAccessor.json" }
};

const DEPLOY_ORDER = [
  "entryPoint",
  "safeSingleton",
  "safeProxyFactory",
  "safeModuleSetup",
  "safe4337Module",
  "multiSend",
  "multiSendCallOnly",
  "fallbackHandler",
  "signMessageLib",
  "createCall",
  "simulateTxAccessor"
] as const;

export async function deployAA(
  client: Parameters<typeof deployFromArtifact>[1],
  walletClient: Parameters<typeof deployFromArtifact>[0],
  _previousScopes: Record<string, ScopeResult>,
  _config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Deploying AA infrastructure...");
  const contracts: Record<string, string> = {};

  for (const name of DEPLOY_ORDER) {
    const known = KNOWN_ADDRESSES[name];

    if (known && (await isDeployed(client, known))) {
      console.log(`  ${name} already at ${known}`);
      contracts[name] = known;
      continue;
    }

    if (name === "entryPoint") {
      const canonical = KNOWN_ADDRESSES.entryPoint;
      console.log(`  Deploying EntryPoint v0.7 via CREATE2 at ${canonical}...`);

      const epArtifact = JSON.parse(
        readFileSync(join(import.meta.dirname, "../entrypoint-v07-initcode.json"), "utf-8")
      ) as { bytecode: Hex };
      const initcode = epArtifact.bytecode;

      const hash = await walletClient.sendTransaction({
        to: DETERMINISTIC_DEPLOYER,
        data: (ENTRYPOINT_SALT + initcode.slice(2)) as Hex,
        gas: 6_000_000n
      });
      await client.waitForTransactionReceipt({ hash });

      if (!(await isDeployed(client, canonical))) {
        throw new Error(`EntryPoint CREATE2 did not produce canonical address ${canonical}`);
      }

      console.log(`  entryPoint deployed at ${canonical}`);
      contracts[name] = canonical;
      continue;
    }

    const artifact = ARTIFACTS[name];
    if (!artifact || !artifactExists(artifact.path)) {
      console.log(`  Skipping ${name} — run forge install for AA deps and enable src/aa/AAImports.sol`);
      continue;
    }

    const args = name === "safe4337Module" ? [contracts.entryPoint] : undefined;
    const addr = await deployFromArtifact(
      walletClient,
      client,
      artifact.path,
      args,
      undefined,
      `livestreak.${name}`
    );
    contracts[name] = addr;
  }

  return {
    status: "completed",
    deployedAt: new Date().toISOString(),
    contracts
  };
}

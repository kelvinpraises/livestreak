import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Abi, Address, PublicClient, WalletClient } from "viem";
import { parseEther } from "viem";
import { deployFromArtifact, type ScopeResult } from "../utils.js";

const LABEL = "livestreak";
const CONTRACTS_ROOT = resolve(import.meta.dirname, "../..");

function loadAbi(artifactPath: string): Abi {
  return JSON.parse(readFileSync(join(CONTRACTS_ROOT, artifactPath), "utf-8")).abi;
}

export async function deployPaymaster(
  client: PublicClient,
  walletClient: WalletClient,
  previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Deploying LiveStreakPaymaster...");

  const aa = previousScopes.aa;
  if (aa?.status !== "completed" || !aa.contracts) {
    return { status: "failed", error: "AA scope not completed" };
  }

  const entryPoint = aa.contracts.entryPoint as Address;

  if (!process.env.OPERATOR_ADDRESS) {
    process.env.OPERATOR_ADDRESS = config.deployer;
    console.log(`  OPERATOR_ADDRESS unset — using deployer ${config.deployer}`);
  }
  const verifyingSigner = process.env.OPERATOR_ADDRESS as Address;
  console.log(`  EntryPoint: ${entryPoint}`);
  console.log(`  Verifying signer: ${verifyingSigner}`);

  // 1. Deploy LiveStreakPaymaster(entryPoint, verifyingSigner, deployer).
  //    Explicit owner (deployer) is required because CREATE2 sets msg.sender = factory.
  const paymaster = await deployFromArtifact(
    walletClient,
    client,
    "out/LiveStreakPaymaster.sol/LiveStreakPaymaster.json",
    [entryPoint, verifyingSigner, config.deployer],
    undefined,
    `${LABEL}.verifyingPaymaster`
  );

  // 2. Fund the paymaster's gas deposit on the EntryPoint.
  console.log("  Funding paymaster (0.05 ETH deposit)...");
  const epAbi = loadAbi("out/EntryPoint.sol/EntryPoint.json");
  const depositHash = await walletClient.writeContract({
    address: entryPoint,
    abi: epAbi,
    functionName: "depositTo",
    args: [paymaster],
    value: parseEther("0.05")
  } as never);
  await client.waitForTransactionReceipt({ hash: depositHash });
  console.log("  Deposited 0.05 ETH");

  // 3. Stake the paymaster (1 day unstake delay).
  console.log("  Staking paymaster (0.01 ETH, 1 day unstake delay)...");
  const paymasterAbi = loadAbi("out/LiveStreakPaymaster.sol/LiveStreakPaymaster.json");
  const stakeHash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "addStake",
    args: [86400],
    value: parseEther("0.01")
  } as never);
  await client.waitForTransactionReceipt({ hash: stakeHash });
  console.log("  Staked 0.01 ETH");

  return {
    status: "completed",
    deployedAt: new Date().toISOString(),
    contracts: {
      verifyingPaymaster: paymaster,
      verifyingSigner
    }
  };
}

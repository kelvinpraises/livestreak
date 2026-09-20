// Deploy the livestreak program to a Solana cluster and write the deployment snapshot.
// Node-only tooling (spawns the solana CLI for the program deploy; web3.js for the rest).
//
//   npm run deploy:solana -- --name localnet [--force] [--default-steward <base58>]
//
// Requires: the Anza toolchain on PATH (solana CLI) and a built program
// (anchor build -> program/target/deploy/livestreak.so).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { REGISTRY_SEED } from "../seeds.js";
import type { SolanaDeployment, SolanaDeploymentName } from "../types.js";
import { DEPLOYMENTS_DIR, PROGRAM_DIR, writeDeployment } from "./utils.js";

// From idl/livestreak.json — instruction "initialize".
const INITIALIZE_DISC = Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]);

interface Args {
  name: SolanaDeploymentName;
  force: boolean;
  defaultSteward?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = (get("--name") ?? "localnet") as SolanaDeploymentName;
  return { name, force: argv.includes("--force"), defaultSteward: get("--default-steward") };
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rpc =
    process.env.LIVESTREAK_SOLANA_RPC_URL ??
    (args.name === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com");
  const snapshotPath = join(DEPLOYMENTS_DIR, `${args.name}.json`);
  if (existsSync(snapshotPath) && !args.force) {
    console.log(`deployment ${args.name} exists — pass --force to redeploy`);
    return;
  }

  const soPath = join(PROGRAM_DIR, "target", "deploy", "livestreak.so");
  const programKeypairPath = join(PROGRAM_DIR, "target", "deploy", "livestreak-keypair.json");
  if (!existsSync(soPath)) {
    throw new Error(`program not built: ${soPath} — run anchor build first`);
  }

  const deployerPath =
    process.env.LIVESTREAK_SOLANA_DEPLOYER_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(deployerPath)) {
    execFileSync("solana-keygen", ["new", "--no-bip39-passphrase", "-o", deployerPath], {
      stdio: "inherit",
    });
  }
  const deployer = loadKeypair(deployerPath);
  const connection = new Connection(rpc, "confirmed");

  // Localnet: make sure the deployer can pay for the program account (~2x .so size).
  if (args.name === "localnet") {
    const balance = await connection.getBalance(deployer.publicKey);
    if (balance < 10 * LAMPORTS_PER_SOL) {
      const sig = await connection.requestAirdrop(deployer.publicKey, 100 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }
  }

  console.log(`deploying livestreak.so to ${rpc} as ${deployer.publicKey.toBase58()}`);
  execFileSync(
    "solana",
    [
      "program",
      "deploy",
      soPath,
      "--program-id",
      programKeypairPath,
      "--url",
      rpc,
      "--keypair",
      deployerPath,
      "--commitment",
      "confirmed",
    ],
    { stdio: "inherit" },
  );
  const programId = loadKeypair(programKeypairPath).publicKey;

  // Deploy finalizes a slot after the CLI returns — wait until the program is executable.
  for (let i = 0; i < 30; i++) {
    const info = await connection.getAccountInfo(programId);
    if (info?.executable) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const [registry] = PublicKey.findProgramAddressSync([Buffer.from(REGISTRY_SEED)], programId);
  const defaultSteward = args.defaultSteward
    ? new PublicKey(args.defaultSteward)
    : deployer.publicKey;

  const registryInfo = await connection.getAccountInfo(registry);
  if (registryInfo === null) {
    const data = Buffer.concat([INITIALIZE_DISC, defaultSteward.toBytes()]);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    // A program cannot be invoked in the slot it was deployed/upgraded — retry across slots.
    for (let attempt = 1; ; attempt++) {
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [deployer]);
        break;
      } catch (err) {
        if (attempt >= 10) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log(`registry initialized at ${registry.toBase58()} (steward ${defaultSteward.toBase58()})`);
  } else {
    console.log(`registry already initialized at ${registry.toBase58()}`);
  }

  // Mock USDC (6 decimals), mint authority = deployer — dev.sh mints to roles from it.
  const usdcMint = await createMint(connection, deployer, deployer.publicKey, null, 6);
  console.log(`mock USDC mint ${usdcMint.toBase58()}`);

  const snapshot: SolanaDeployment = {
    chain: args.name,
    rpc,
    deployedAt: new Date().toISOString(),
    deployer: deployer.publicKey.toBase58(),
    programId: programId.toBase58(),
    accounts: {
      usdcMint: usdcMint.toBase58(),
      registry: registry.toBase58(),
      defaultSteward: defaultSteward.toBase58(),
    },
  };
  writeDeployment(args.name, snapshot);
  console.log(`wrote deployments/${args.name}.{json,ts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

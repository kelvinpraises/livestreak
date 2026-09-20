// Wire a deployed localnet: hand the registry default steward to the steward ROLE and mint
// mock USDC to the role/UI wallets — the solana mirror of dev.sh's evm_wire/sui_wire step.
// Node-only tooling (web3.js + spl-token), signs with the deployer keypair (= mint authority
// and, at wire time, the current default steward from initialize).
//
//   npm run wire:solana -- [--steward <base58>] [--mint <base58>=<amount>]...
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { REGISTRY_SEED } from "../seeds.js";
import { livestreakIdl } from "../idl/index.js";
import type { SolanaDeployment } from "../types.js";
import { DEPLOYMENTS_DIR } from "./utils.js";

interface Args {
  steward?: string;
  mints: { recipient: string; amount: bigint }[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { mints: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--steward") args.steward = argv[++i];
    if (argv[i] === "--mint") {
      const [recipient, amount] = (argv[++i] ?? "").split("=");
      if (!recipient || !amount) throw new Error("--mint expects <base58>=<amount>");
      args.mints.push({ recipient, amount: BigInt(amount) });
    }
  }
  return args;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const snapshotPath = join(DEPLOYMENTS_DIR, "localnet.json");
  if (!existsSync(snapshotPath)) throw new Error("no localnet deployment — run deploy:solana first");
  const dep = JSON.parse(readFileSync(snapshotPath, "utf8")) as SolanaDeployment;
  const rpc = process.env.LIVESTREAK_SOLANA_RPC_URL ?? dep.rpc;

  const deployerPath =
    process.env.LIVESTREAK_SOLANA_DEPLOYER_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  const deployer = loadKeypair(deployerPath);
  const connection = new Connection(rpc, "confirmed");
  const programId = new PublicKey(dep.programId);
  const usdcMint = new PublicKey(dep.accounts.usdcMint);

  if (args.steward) {
    const steward = new PublicKey(args.steward);
    const [registry] = PublicKey.findProgramAddressSync([Buffer.from(REGISTRY_SEED)], programId);
    // Registry layout: 8 disc + market_count u64 + default_steward 32 + bump.
    const info = await connection.getAccountInfo(registry);
    if (info === null) throw new Error("registry not initialized");
    const current = new PublicKey(info.data.subarray(16, 48));
    if (current.equals(steward)) {
      console.log(`default steward already ${steward.toBase58()}`);
    } else if (!current.equals(deployer.publicKey)) {
      throw new Error(
        `deployer is not the current default steward (${current.toBase58()}) — cannot hand over`,
      );
    } else {
      const disc = livestreakIdl.instructions.find(
        (ix) => ix.name === "set_default_steward",
      )?.discriminator;
      if (!disc) throw new Error("set_default_steward missing from IDL — rebuild + sync-idl");
      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
          { pubkey: registry, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([Uint8Array.from(disc), steward.toBytes()]),
      });
      await sendAndConfirmTransaction(connection, new Transaction().add(ix), [deployer]);
      console.log(`default steward → ${steward.toBase58()}`);
    }
  }

  for (const { recipient, amount } of args.mints) {
    const owner = new PublicKey(recipient);
    const ata = await getOrCreateAssociatedTokenAccount(connection, deployer, usdcMint, owner);
    await mintTo(connection, deployer, usdcMint, ata.address, deployer, amount);
    console.log(`minted ${amount} USDC → ${owner.toBase58()} (ata ${ata.address.toBase58()})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

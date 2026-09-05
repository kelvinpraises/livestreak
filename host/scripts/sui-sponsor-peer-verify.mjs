#!/usr/bin/env node
/**
 * Manual peer-verify: wallet executeSponsoredTransaction against a live host gas station.
 *
 * Prereqs:
 *   - Sui localnet/testnet with funded sponsor (LIVESTREAK_SUI_SPONSOR_SEED + LIVESTREAK_SUI_RPC_URL)
 *   - Host running: `cd host && npm run dev`
 *
 * Run:
 *   node host/scripts/sui-sponsor-peer-verify.mjs --host http://127.0.0.1:8787 --mnemonic "<sender mnemonic>"
 */
import { createSuiAccount } from "@livestreak/wallet";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";

const args = process.argv.slice(2);
const host = readArg(args, "--host") ?? "http://127.0.0.1:8787";
const mnemonic = readArg(args, "--mnemonic");
const rpcUrl = readArg(args, "--rpc") ?? process.env.LIVESTREAK_SUI_RPC_URL ?? process.env.SUI_RPC ?? "http://127.0.0.1:9000";

if (mnemonic === undefined) {
  console.error("Usage: node host/scripts/sui-sponsor-peer-verify.mjs --mnemonic \"<words>\" [--host URL] [--rpc URL]");
  process.exit(1);
}

const client = new SuiClient({ url: rpcUrl });
const account = await createSuiAccount(mnemonic, "0'/0'/0'", { provider: client, isSponsored: true, gasStation: {
  sponsor: async ({ txKindBytes, sender }) => {
    const response = await fetch(`${host}/aa/sui/sponsor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txKindBytes: Buffer.from(txKindBytes).toString("base64"),
        sender
      })
    });

    if (!response.ok) {
      throw new Error(`gas station ${response.status}: ${await response.text()}`);
    }

    const body = await response.json();
    return {
      txBytes: Buffer.from(body.txBytes, "base64"),
      sponsorSignature: body.sponsorSignature,
      sponsorAddress: body.sponsorAddress
    };
  }
}});

const sender = await account.getAddress();
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [1]);
tx.transferObjects([coin], sender);

const result = await account.sendTransaction(tx);
console.log(JSON.stringify({ sender, digest: result.hash, fee: result.fee?.toString() ?? "0" }, null, 2));

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

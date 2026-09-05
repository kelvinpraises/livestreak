#!/usr/bin/env node

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { hostCommand, produceCommand } from "./commands/produce.js";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { vaultConsumerCommands } from "./commands/vaults.js";
import { vaultCommand } from "./commands/vault.js";
import { laneCommands } from "./commands/lanes.js";
import { nftCommands } from "./commands/nft.js";

const root = Command.make("livestreak", {}, () => Effect.void).pipe(
  Command.withSubcommands([
    initCommand,
    loginCommand,
    produceCommand,
    hostCommand,
    ...vaultConsumerCommands,
    vaultCommand,
    ...laneCommands,
    ...nftCommands
  ])
);

const cli = Command.run(root, {
  name: "livestreak",
  version: "0.1.0"
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);

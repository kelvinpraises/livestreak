#!/usr/bin/env node

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { authCommand } from "./commands/auth.js";
import { keystoreCommand } from "./commands/keystore.js";
import { settingsCommand } from "./commands/settings.js";
import { remoteCommands } from "./commands/remote.js";

const root = Command.make("livestreak", {}, () => Effect.void).pipe(
  Command.withSubcommands([authCommand, keystoreCommand, settingsCommand, ...remoteCommands])
);

const cli = Command.run(root, {
  name: "livestreak",
  version: "0.1.0"
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);

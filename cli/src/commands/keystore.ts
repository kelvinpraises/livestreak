import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  defaultKeystorePath,
  ensureAndUnlock,
  keystoreExists
} from "../gateway/auth/keystore.js";
import { resolveOperator } from "../gateway/auth/identity.js";
import { resolvePassword } from "../gateway/auth/password.js";
import { passwordOpt } from "./args.js";

export const runKeystoreStatus = async (): Promise<string> => {
  const path = defaultKeystorePath();
  const exists = await keystoreExists(path);
  return exists ? `keystore: ${path} (present)` : `keystore: ${path} (missing — will be created on unlock)`;
};

export const runKeystoreUnlock = async (input?: { readonly password?: string }): Promise<string> => {
  const path = defaultKeystorePath();
  const password = await resolvePassword(input?.password);
  const { seed } = resolveOperator(password);
  const unlocked = await ensureAndUnlock(path, seed, password);
  unlocked.lock();
  return `keystore unlocked and re-locked: ${path}`;
};

const keystoreStatusCommand = Command.make("status", {}, () =>
  Effect.tryPromise({
    try: () => runKeystoreStatus(),
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  }).pipe(Effect.flatMap((msg) => Console.log(msg)))
);

const keystoreUnlockCommand = Command.make(
  "unlock",
  { password: passwordOpt },
  ({ password }) =>
    Effect.tryPromise({
      try: () =>
        runKeystoreUnlock({
          ...(Option.isSome(password) ? { password: password.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((msg) => Console.log(msg)))
);

export const keystoreCommand = Command.make("keystore").pipe(
  Command.withSubcommands([keystoreStatusCommand, keystoreUnlockCommand])
);

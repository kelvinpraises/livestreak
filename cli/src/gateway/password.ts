import { Prompt } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect, Redacted } from "effect";

/**
 * Prompt the operator for their password via a masked terminal input.
 * Throws when stdin is not a TTY (non-interactive; no way to prompt).
 */
export const promptPassword = async (): Promise<string> => {
  const prompt = Prompt.password({ message: "Operator password: " });
  const redacted = await Effect.runPromise(
    Prompt.run(prompt).pipe(Effect.provide(NodeContext.layer))
  );
  return Redacted.value(redacted);
};

/**
 * Resolve the operator password with precedence:
 *   1. explicit `--password` flag value
 *   2. `LIVESTREAK_PASSWORD` environment variable
 *   3. interactive masked prompt (TTY only)
 *
 * Throws loudly when non-interactive and neither flag nor env is set.
 */
export const resolvePassword = async (
  flag?: string,
  env?: string
): Promise<string> => {
  if (flag !== undefined && flag.length > 0) {
    return flag;
  }

  const envVal = env ?? process.env["LIVESTREAK_PASSWORD"];
  if (envVal !== undefined && envVal.length > 0) {
    return envVal;
  }

  // Guard: non-interactive shells cannot prompt
  if (process.stdin.isTTY !== true) {
    throw new Error(
      "Operator password required: set LIVESTREAK_PASSWORD or pass --password (non-interactive shell detected)"
    );
  }

  return promptPassword();
};

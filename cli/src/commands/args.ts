import { Options } from "@effect/cli";
import { Option } from "effect";

export const settingsPathOpt = Options.file("settings").pipe(
  Options.withDescription("Path to settings.json"),
  Options.optional
);

export const passwordOpt = Options.text("password").pipe(Options.optional);

export const readSettingsPath = (settings: Option.Option<string>): { readonly settingsPath?: string } => ({
  ...(Option.isSome(settings) ? { settingsPath: settings.value } : {})
});

export const readPassword = (password: Option.Option<string>): { readonly password?: string } => ({
  ...(Option.isSome(password) ? { password: password.value } : {})
});

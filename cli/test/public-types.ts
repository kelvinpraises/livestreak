// Compiled by tsconfig.public.json: Vitest transpilation alone does not check types.
import type * as Pub from "../agent-client.js";
import type * as Src from "../src/agent-client.js";
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const outcome: Equal<Pub.RemoteCallOutcome, Src.RemoteCallOutcome> = true;
export const drive: Equal<Pub.RemoteDriveInput, Src.RemoteDriveInput> = true;
export const client: Equal<Pub.RemoteUiClient, Src.RemoteUiClient> = true;

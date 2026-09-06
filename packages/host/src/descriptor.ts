import { OutputMode } from "@livestreak/schema";
import { Schema } from "effect";
import { MemoryDescriptorAdvert } from "./memory.js";
import {
  ContentDescriptorAdvert,
  WalrusDescriptorAdvert
} from "./walrus.js";

// --- exports ---

export { OutputMode, type OutputMode as HostOutputMode } from "@livestreak/schema";

export const HostModuleToken = Schema.Literal(
  "aa",
  "media",
  "walrus_memory",
  "walrus_content",
  "discovery",
  // Remote Bridge Console relay router (Objective 4, P4). Canonicalized here from
  // the wave-1 local superset; mirrors `remoteModuleToken` in @livestreak/schema.
  "remote"
);

export type HostModuleToken = Schema.Schema.Type<typeof HostModuleToken>;

export { MemoryTrustModel, MemoryDescriptorAdvert } from "./memory.js";

export {
  WalrusNetwork,
  ContentDescriptorAdvert,
  WalrusDescriptorAdvert,
  PointerScheme,
  StorePointer,
  ContentBlobStoreRequest,
  ContentPersistence,
  pointerSchemeForNetwork
} from "./walrus.js";

export const MediaDescriptorAdvert = Schema.Struct({
  simulcastAvailable: Schema.Boolean
});

export type MediaDescriptorAdvert = Schema.Schema.Type<typeof MediaDescriptorAdvert>;

export const HostProviderDescriptor = Schema.Struct({
  version: Schema.Literal("0.1.0"),
  hostId: Schema.NonEmptyString,
  baseUrl: Schema.NonEmptyString,
  modules: Schema.Array(HostModuleToken),
  supportedOutputs: Schema.Array(OutputMode),
  media: MediaDescriptorAdvert,
  walrus: WalrusDescriptorAdvert,
  memory: MemoryDescriptorAdvert,
  content: ContentDescriptorAdvert,
  termsVersion: Schema.optional(Schema.NonEmptyString)
});

export type HostProviderDescriptor = Schema.Schema.Type<typeof HostProviderDescriptor>;

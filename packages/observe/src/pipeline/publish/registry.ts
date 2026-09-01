import type {
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryFlagDescriptor,
  SinkDriverDescriptor
} from "./types.js";

export interface SinkRegistryEntry {
  readonly descriptor: SinkDriverDescriptor;
}

export interface PublishRegistry {
  readonly sinks: readonly SinkRegistryEntry[];
}

export interface PublishRegistryInput {
  readonly sinks?: readonly SinkRegistryEntry[];
}

export const createPublishRegistry = (input: PublishRegistryInput): PublishRegistry => {
  let sinks: readonly SinkRegistryEntry[] = [];

  if (input.sinks !== undefined) {
    sinks = input.sinks;
  }

  return { sinks };
};

export const listSinkDescriptors = (
  registry: PublishRegistry
): readonly SinkDriverDescriptor[] => registry.sinks.map((entry) => entry.descriptor);

export const getSinkDescriptor = (
  registry: PublishRegistry,
  id: string
): SinkDriverDescriptor | undefined =>
  listSinkDescriptors(registry).find((descriptor) => descriptor.id === id);

export const listSinkFlags = (
  registry: PublishRegistry,
  id?: string
): readonly RegistryFlagDescriptor[] =>
  listSinkDescriptors(registry).flatMap((descriptor) => flagsForDescriptor(descriptor, id));

export interface SinkCommandMatch {
  readonly descriptor: SinkDriverDescriptor;
  readonly command: RegistryCommandDescriptor;
}

export const listSinkCommands = (
  registry: PublishRegistry,
  id?: string
): readonly SinkCommandMatch[] =>
  listSinkDescriptors(registry).flatMap((descriptor) => commandsForDescriptor(descriptor, id));

export const getSinkCommand = (
  registry: PublishRegistry,
  scope: RegistryCommandScope
): SinkCommandMatch | undefined =>
  listSinkCommands(registry).find((match) => match.command.scope === scope);

export const sinkDescriptorSupportsCommand = (
  descriptor: SinkDriverDescriptor,
  scope: RegistryCommandScope
): boolean => descriptor.commands.some((command) => command.scope === scope);

export const sinkDescriptorCommandScopes = (
  descriptor: SinkDriverDescriptor
): readonly RegistryCommandScope[] => descriptor.commands.map((command) => command.scope);

// --- helpers ---

const flagsForDescriptor = (
  descriptor: SinkDriverDescriptor,
  id?: string
): readonly RegistryFlagDescriptor[] => {
  if (id === undefined) {
    return descriptor.flags;
  }

  if (descriptor.id === id) {
    return descriptor.flags;
  }

  return [];
};

const commandsForDescriptor = (
  descriptor: SinkDriverDescriptor,
  id?: string
): readonly SinkCommandMatch[] => {
  if (id === undefined) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  if (descriptor.id === id) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  return [];
};

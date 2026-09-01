import type {
  ProcessPackDescriptor,
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryFlagDescriptor
} from "./types.js";

export interface ProcessRegistryEntry {
  readonly descriptor: ProcessPackDescriptor;
}

export interface ProcessRegistry {
  readonly packs: readonly ProcessRegistryEntry[];
}

export interface ProcessRegistryInput {
  readonly packs?: readonly ProcessRegistryEntry[];
}

export const createProcessRegistry = (input: ProcessRegistryInput): ProcessRegistry => {
  let packs: readonly ProcessRegistryEntry[] = [];

  if (input.packs !== undefined) {
    packs = input.packs;
  }

  return { packs };
};

export const listProcessDescriptors = (
  registry: ProcessRegistry
): readonly ProcessPackDescriptor[] => registry.packs.map((entry) => entry.descriptor);

export const getProcessDescriptor = (
  registry: ProcessRegistry,
  id: string
): ProcessPackDescriptor | undefined =>
  listProcessDescriptors(registry).find((descriptor) => descriptor.id === id);

export const listProcessFlags = (
  registry: ProcessRegistry,
  id?: string
): readonly RegistryFlagDescriptor[] =>
  listProcessDescriptors(registry).flatMap((descriptor) => flagsForDescriptor(descriptor, id));

export interface ProcessCommandMatch {
  readonly descriptor: ProcessPackDescriptor;
  readonly command: RegistryCommandDescriptor;
}

export const listProcessCommands = (
  registry: ProcessRegistry,
  id?: string
): readonly ProcessCommandMatch[] =>
  listProcessDescriptors(registry).flatMap((descriptor) => commandsForDescriptor(descriptor, id));

export const getProcessCommand = (
  registry: ProcessRegistry,
  scope: RegistryCommandScope
): ProcessCommandMatch | undefined =>
  listProcessCommands(registry).find((match) => match.command.scope === scope);

export const processDescriptorSupportsCommand = (
  descriptor: ProcessPackDescriptor,
  scope: RegistryCommandScope
): boolean => descriptor.commands.some((command) => command.scope === scope);

export const processDescriptorCommandScopes = (
  descriptor: ProcessPackDescriptor
): readonly RegistryCommandScope[] => descriptor.commands.map((command) => command.scope);

// --- helpers ---

const flagsForDescriptor = (
  descriptor: ProcessPackDescriptor,
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
  descriptor: ProcessPackDescriptor,
  id?: string
): readonly ProcessCommandMatch[] => {
  if (id === undefined) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  if (descriptor.id === id) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  return [];
};

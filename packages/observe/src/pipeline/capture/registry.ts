import type {
  CaptureDriverDescriptor,
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryFlagDescriptor
} from "./types.js";

export interface CaptureRegistryEntry {
  readonly descriptor: CaptureDriverDescriptor;
}

export interface CaptureRegistry {
  readonly drivers: readonly CaptureRegistryEntry[];
}

export interface CaptureRegistryInput {
  readonly drivers?: readonly CaptureRegistryEntry[];
}

export const createCaptureRegistry = (input: CaptureRegistryInput): CaptureRegistry => {
  let drivers: readonly CaptureRegistryEntry[] = [];

  if (input.drivers !== undefined) {
    drivers = input.drivers;
  }

  return { drivers };
};

export const listCaptureDescriptors = (
  registry: CaptureRegistry
): readonly CaptureDriverDescriptor[] => registry.drivers.map((entry) => entry.descriptor);

export const getCaptureDescriptor = (
  registry: CaptureRegistry,
  id: string
): CaptureDriverDescriptor | undefined =>
  listCaptureDescriptors(registry).find((descriptor) => descriptor.id === id);

export const listCaptureFlags = (
  registry: CaptureRegistry,
  id?: string
): readonly RegistryFlagDescriptor[] =>
  listCaptureDescriptors(registry).flatMap((descriptor) => flagsForDescriptor(descriptor, id));

export interface CaptureCommandMatch {
  readonly descriptor: CaptureDriverDescriptor;
  readonly command: RegistryCommandDescriptor;
}

export const listCaptureCommands = (
  registry: CaptureRegistry,
  id?: string
): readonly CaptureCommandMatch[] =>
  listCaptureDescriptors(registry).flatMap((descriptor) => commandsForDescriptor(descriptor, id));

export const getCaptureCommand = (
  registry: CaptureRegistry,
  scope: RegistryCommandScope
): CaptureCommandMatch | undefined =>
  listCaptureCommands(registry).find((match) => match.command.scope === scope);

export const captureDescriptorSupportsCommand = (
  descriptor: CaptureDriverDescriptor,
  scope: RegistryCommandScope
): boolean => descriptor.commands.some((command) => command.scope === scope);

export const captureDescriptorCommandScopes = (
  descriptor: CaptureDriverDescriptor
): readonly RegistryCommandScope[] => descriptor.commands.map((command) => command.scope);

// --- helpers ---

const flagsForDescriptor = (
  descriptor: CaptureDriverDescriptor,
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
  descriptor: CaptureDriverDescriptor,
  id?: string
): readonly CaptureCommandMatch[] => {
  if (id === undefined) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  if (descriptor.id === id) {
    return descriptor.commands.map((command) => ({ descriptor, command }));
  }

  return [];
};

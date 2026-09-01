import type { CaptureDriverDescriptor } from "./capture/types.js";
import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import {
  createCaptureRegistry,
  type CaptureRegistry,
  type CaptureRegistryInput
} from "./capture/registry.js";
import type { ProcessPackDescriptor } from "./process/types.js";
import {
  createProcessRegistry,
  type ProcessRegistry,
  type ProcessRegistryInput
} from "./process/registry.js";
import type { SinkDriverDescriptor } from "./publish/types.js";
import {
  createPublishRegistry,
  type PublishRegistry,
  type PublishRegistryInput
} from "./publish/registry.js";
import type {
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryDescriptorKind,
  RegistryFlagDescriptor
} from "./shared.js";

export interface ObserveRegistry {
  readonly capture: CaptureRegistry;
  readonly process: ProcessRegistry;
  readonly publish: PublishRegistry;
}

export interface ObserveRegistryInput {
  readonly capture?: CaptureRegistryInput;
  readonly process?: ProcessRegistryInput;
  readonly publish?: PublishRegistryInput;
}

export type ObserveRegistryDescriptor =
  | CaptureDriverDescriptor
  | ProcessPackDescriptor
  | SinkDriverDescriptor;

export interface RegistryCommandMatch {
  readonly descriptor: ObserveRegistryDescriptor;
  readonly command: RegistryCommandDescriptor;
}

export const createObserveRegistry = (input: ObserveRegistryInput): ObserveRegistry => {
  let captureInput: CaptureRegistryInput = {};
  let processInput: ProcessRegistryInput = {};
  let publishInput: PublishRegistryInput = {};

  if (input.capture !== undefined) {
    captureInput = input.capture;
  }

  if (input.process !== undefined) {
    processInput = input.process;
  }

  if (input.publish !== undefined) {
    publishInput = input.publish;
  }

  return {
    capture: createCaptureRegistry(captureInput),
    process: createProcessRegistry(processInput),
    publish: createPublishRegistry(publishInput)
  };
};

export const listRegistryDescriptors = (
  registry: ObserveRegistry,
  kind?: RegistryDescriptorKind
): readonly ObserveRegistryDescriptor[] => {
  if (kind === undefined) {
    return [
      ...listRegistryDescriptors(registry, "capture"),
      ...listRegistryDescriptors(registry, "process"),
      ...listRegistryDescriptors(registry, "publish")
    ];
  }

  if (kind === "capture") {
    return registry.capture.drivers.map((entry) => entry.descriptor);
  }

  if (kind === "process") {
    return registry.process.packs.map((entry) => entry.descriptor);
  }

  return registry.publish.sinks.map((entry) => entry.descriptor);
};

export function getRegistryDescriptor(
  registry: ObserveRegistry,
  kind: "capture",
  id: string
): CaptureDriverDescriptor | undefined;
export function getRegistryDescriptor(
  registry: ObserveRegistry,
  kind: "process",
  id: string
): ProcessPackDescriptor | undefined;
export function getRegistryDescriptor(
  registry: ObserveRegistry,
  kind: "publish",
  id: string
): SinkDriverDescriptor | undefined;
export function getRegistryDescriptor(
  registry: ObserveRegistry,
  kind: RegistryDescriptorKind,
  id: string
): ObserveRegistryDescriptor | undefined {
  return listRegistryDescriptors(registry, kind).find((descriptor) => descriptor.id === id);
}

export const listRegistryFlags = (
  registry: ObserveRegistry,
  kind?: RegistryDescriptorKind,
  id?: string
): readonly RegistryFlagDescriptor[] =>
  listRegistryDescriptors(registry, kind).flatMap((descriptor) => {
    if (id === undefined) {
      return descriptor.flags;
    }

    if (descriptor.id === id) {
      return descriptor.flags;
    }

    return [];
  });

export const listRegistryCommands = (
  registry: ObserveRegistry,
  kind?: RegistryDescriptorKind,
  id?: string
): readonly RegistryCommandMatch[] =>
  listRegistryDescriptors(registry, kind).flatMap((descriptor) => {
    if (id === undefined) {
      return descriptor.commands.map((command) => ({ descriptor, command }));
    }

    if (descriptor.id === id) {
      return descriptor.commands.map((command) => ({ descriptor, command }));
    }

    return [];
  });

export const getRegistryCommand = (
  registry: ObserveRegistry,
  scope: RegistryCommandScope
): RegistryCommandMatch | undefined =>
  listRegistryCommands(registry).find((match) => match.command.scope === scope);

export const descriptorSupportsCommand = (
  descriptor: ObserveRegistryDescriptor,
  scope: RegistryCommandScope
): boolean => descriptor.commands.some((command) => command.scope === scope);

export const descriptorCommandScopes = (
  descriptor: ObserveRegistryDescriptor
): readonly RegistryCommandScope[] => descriptor.commands.map((command) => command.scope);

export const descriptorsExposeDifferentCommands = (
  left: ObserveRegistryDescriptor,
  right: ObserveRegistryDescriptor
): boolean => {
  const leftScopes = new Set(descriptorCommandScopes(left));
  const rightScopes = new Set(descriptorCommandScopes(right));

  if (leftScopes.size !== rightScopes.size) {
    return true;
  }

  for (const scope of leftScopes) {
    if (!rightScopes.has(scope)) {
      return true;
    }
  }

  return false;
};

export const assertRegistryCommandAdvertised = (
  registry: ObserveRegistry,
  kind: RegistryDescriptorKind,
  descriptorId: string,
  scope: RegistryCommandScope
): Effect.Effect<void, LiveStreakConfigError> => {
  const descriptor = lookupRegistryDescriptor(registry, kind, descriptorId);

  if (descriptor === undefined) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `Registry descriptor ${kind}/${descriptorId} is not registered`
      })
    );
  }

  return descriptorSupportsCommand(descriptor, scope)
    ? Effect.void
    : Effect.fail(
        new LiveStreakConfigError({
          message: `Registry descriptor ${descriptorId} does not advertise command scope ${scope}`,
          metadata: {
            cause: {
              kind,
              descriptorId,
              scope
            }
          }
        })
      );
};

const lookupRegistryDescriptor = (
  registry: ObserveRegistry,
  kind: RegistryDescriptorKind,
  descriptorId: string
): ObserveRegistryDescriptor | undefined => {
  switch (kind) {
    case "capture": {
      return getRegistryDescriptor(registry, "capture", descriptorId);
    }
    case "process": {
      return getRegistryDescriptor(registry, "process", descriptorId);
    }
    case "publish": {
      return getRegistryDescriptor(registry, "publish", descriptorId);
    }
  }
};

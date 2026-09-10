import type { DescriptorValueSchema } from "#pipeline/shared.js";
import type { ObserveRegistry } from "#pipeline/registry.js";
import { builtInObserveRegistry } from "#builtins.js";
import { pausePresentationValues } from "#pipeline/capture/index.js";
import { marketCatalogFunctions } from "#market/control.js";
import { systemConfigCatalogFunctions } from "./system/config.js";
import { systemRunCatalogFunctions } from "./system/run.js";

export type JsonSchema = DescriptorValueSchema;

export type CatalogFunctionResult = "patch" | "artifact" | "patch+artifact";

export interface CatalogFunction {
  readonly scope: string;
  readonly label: string;
  readonly description: string;
  readonly result: CatalogFunctionResult;
  readonly input?: JsonSchema;
  readonly output?: JsonSchema;
}

export type CatalogRegistryKind = "capture" | "process" | "sink" | "system";

export interface CatalogCell {
  readonly label: string;
  readonly registryKind: CatalogRegistryKind;
  readonly registryId: string;
  readonly functions: Readonly<Record<string, CatalogFunction>>;
}

export interface ControlCatalog {
  readonly version: string;
  readonly cells: Readonly<Record<string, CatalogCell>>;
  readonly shapes?: Readonly<Record<string, JsonSchema>>;
  readonly artifacts?: Readonly<Record<string, JsonSchema>>;
}

export const defaultControlCatalogVersion = "0.1.0";

export const buildControlCatalog = (
  registry: ObserveRegistry = builtInObserveRegistry
): ControlCatalog => ({
  version: defaultControlCatalogVersion,
  cells: {
    ...buildRegistryCatalogCells(registry),
    ...systemCatalogCells()
  },
  artifacts: {
    "browser.previewTargets": browserPreviewTargetsArtifactSchema()
  }
});

const buildRegistryCatalogCells = (
  registry: ObserveRegistry
): Record<string, CatalogCell> => {
  const cells: Record<string, CatalogCell> = {};

  for (const entry of registry.capture.drivers) {
    const descriptor = entry.descriptor;
    const cellId = `capture:${descriptor.id}`;
    cells[cellId] = {
      label: descriptor.displayName,
      registryKind: "capture",
      registryId: descriptor.id,
      functions: catalogFunctionsFromCommands(descriptor.commands)
    };
  }

  for (const entry of registry.publish.sinks) {
    const descriptor = entry.descriptor;
    const cellId = `sink:${descriptor.id === "file" ? "file-export" : descriptor.id}`;
    cells[cellId] ??= {
      label: descriptor.displayName,
      registryKind: "sink",
      registryId: descriptor.id,
      functions: catalogFunctionsFromCommands(descriptor.commands)
    };
  }

  return cells;
};

const systemCatalogCells = (): Record<string, CatalogCell> => ({
  "system:config": {
    label: "Config",
    registryKind: "system",
    registryId: "config",
    functions: systemConfigCatalogFunctions() as Record<string, CatalogFunction>
  },
  "system:run": {
    label: "Run",
    registryKind: "system",
    registryId: "run",
    functions: systemRunCatalogFunctions() as Record<string, CatalogFunction>
  },
  "system:pause": {
    label: "Pause",
    registryKind: "system",
    registryId: "pause",
    functions: {
      pause: {
        scope: "system:pause:pause",
        label: "Pause",
        description: "Request media pumping pause.",
        result: "patch"
      },
      resume: {
        scope: "system:pause:resume",
        label: "Resume",
        description: "Clear pause request.",
        result: "patch"
      },
      setPresentation: {
        scope: "system:pause:setPresentation",
        label: "Set pause presentation",
        description: "Update the presentation used by future pauses.",
        result: "patch",
        input: {
          type: "object",
          properties: [
            {
              name: "whilePaused",
              value: {
                type: "enum",
                description: "Visual presentation while paused.",
                values: [...pausePresentationValues]
              },
              help: "hold keeps the last frame visible; slate covers with a static asset."
            },
            {
              name: "slateAssetId",
              value: { type: "string", description: "Static image asset id for slate presentation." },
              help: 'Required when whilePaused is "slate".'
            }
          ]
        }
      }
    }
  },
  "system:memory": {
    label: "Memory",
    registryKind: "system",
    registryId: "memory",
    functions: {}
  },
  "system:tick": {
    label: "Tick",
    registryKind: "system",
    registryId: "tick",
    functions: {}
  },
  market: {
    label: "Market",
    registryKind: "system",
    registryId: "market",
    functions: marketCatalogFunctions() as Record<string, CatalogFunction>
  }
});

const catalogFunctionsFromCommands = (
  commands: readonly {
    readonly name: string;
    readonly scope: string;
    readonly help: string;
    readonly input?: JsonSchema;
    readonly output?: JsonSchema;
    readonly resultKind?: "artifact" | "state-patch";
  }[]
): Record<string, CatalogFunction> => {
  const functions: Record<string, CatalogFunction> = {};

  for (const command of commands) {
    functions[command.name] = {
      scope: command.scope,
      label: command.name,
      description: command.help,
      result: mapResultKind(command.resultKind),
      ...(command.input === undefined ? {} : { input: command.input }),
      ...(command.output === undefined ? {} : { output: command.output })
    };
  }

  return functions;
};

const mapResultKind = (
  resultKind: "artifact" | "state-patch" | undefined
): CatalogFunctionResult => {
  if (resultKind === "artifact") {
    return "artifact";
  }
  return "patch";
};

const browserPreviewTargetsArtifactSchema = (): JsonSchema => ({
  type: "object",
  description: "Browser preview image and numbered target list.",
  properties: [
    {
      name: "preview",
      value: { type: "object", description: "Preview image payload." },
      help: "Fresh browser preview snapshot."
    },
    {
      name: "targets",
      value: {
        type: "array",
        description: "Detected browser targets.",
        items: { type: "object", description: "One browser target." }
      },
      help: "Numbered browser targets from the latest inspection."
    }
  ]
});

export const findCatalogFunctionByScope = (
  catalog: ControlCatalog,
  scope: string
): CatalogFunction | undefined => {
  for (const cell of Object.values(catalog.cells)) {
    for (const catalogFunction of Object.values(cell.functions)) {
      if (catalogFunction.scope === scope) {
        return catalogFunction;
      }
    }
  }

  return undefined;
};

// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// Track D: emit a configurator root (`steward:config`) with configure + close, plus per-subject
// groups with steward actions as children. Every node carries id/parentId/package/visible via
// withDescriptorIdentity.

import type { CapabilityScope, FunctionDescriptor, JsonSchema } from "@livestreak/schema";
import { bridgeActionScope, withDescriptorIdentity } from "@livestreak/schema";

import { bridgeControlsReadScope } from "../types.js";
import { projectStewardFunctions } from "./project.js";
import type { StewardFunctionView, StewardPanelInput, StewardStateSnapshot } from "./types.js";

const PACKAGE = "steward" as const;
const ROOT_ID = "steward.root";
const CONFIG_ID = "steward.config.configure";
const CLOSE_ID = "steward.config.close";

// --- exports ---

export const projectStewardDescriptors = (
  snapshot: StewardStateSnapshot | StewardPanelInput
): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];
  const views = projectStewardFunctions(snapshot as StewardStateSnapshot);

  pushRoot(descriptors);
  pushConfigurator(descriptors);
  pushSubjectGroups(descriptors, snapshot);
  for (const view of views) {
    descriptors.push(toActionDescriptor(view));
  }

  return descriptors;
};

// --- tree nodes ---

// Single root pane: configure/close + per-subject groups all nest under one "Steward" group, so the
// configure FORM stays a card (it must NOT itself be the parent, or it renders as a header and the
// form vanishes). Uniform shape across packages.
const pushRoot = (descriptors: FunctionDescriptor[]): void => {
  descriptors.push(
    withDescriptorIdentity(
      {
        id: ROOT_ID,
        name: "steward",
        label: "Steward",
        scope: bridgeControlsReadScope,
        nodeKind: "group",
        order: 0,
        disabled: false,
        visible: true
      },
      { package: PACKAGE, idPrefix: "root" }
    )
  );
};

const pushConfigurator = (descriptors: FunctionDescriptor[]): void => {
  descriptors.push(
    withDescriptorIdentity(
      {
        id: CONFIG_ID,
        parentId: ROOT_ID,
        name: "configure",
        label: "Configure steward",
        scope: `${bridgeActionScope}:configure` as CapabilityScope,
        nodeKind: "action",
        order: 0,
        disabled: false,
        visible: true,
        inputSchema: CONFIGURE_INPUT_SCHEMA
      },
      { package: PACKAGE, idPrefix: "config" }
    )
  );

  descriptors.push(
    withDescriptorIdentity(
      {
        id: CLOSE_ID,
        parentId: ROOT_ID,
        name: "close",
        label: "Close",
        scope: `${bridgeActionScope}:close` as CapabilityScope,
        nodeKind: "action",
        order: 1,
        disabled: false,
        visible: true
      },
      { package: PACKAGE, idPrefix: "config" }
    )
  );
};

const pushSubjectGroups = (
  descriptors: FunctionDescriptor[],
  snapshot: StewardStateSnapshot | StewardPanelInput
): void => {
  const seen = new Set<string>();
  for (const subject of snapshot.watchedSubjects) {
    if (seen.has(subject.id)) {
      continue;
    }
    seen.add(subject.id);
    const groupId = subjectGroupIdFor(subject.id);
    descriptors.push(
      withDescriptorIdentity(
        {
          id: groupId,
          parentId: ROOT_ID,
          name: "subject",
          label: subjectLabel(subject),
          scope: bridgeControlsReadScope,
          nodeKind: "group",
          order: 10,
          disabled: false,
          // Board-first reveal: a watched vault/market subject (seeded by configure) lights up; the
          // always-present steward-self subject stays hidden until there is something to act on.
          visible: subject.kind === "vault" || subject.kind === "market",
          target: { kind: subject.kind, ...(subject.marketId === undefined ? {} : { marketId: subject.marketId }) }
        },
        { package: PACKAGE, idPrefix: "group" }
      )
    );
  }
};

const toActionDescriptor = (view: StewardFunctionView): FunctionDescriptor => {
  const parentId = subjectGroupIdFor(view.target?.subjectId ?? "unknown");
  const target = toTarget(view);

  return withDescriptorIdentity(
    {
      id: `${parentId}.action.${view.name}`,
      parentId,
      name: view.name,
      label: view.label,
      scope: `${bridgeActionScope}:${view.name}` as CapabilityScope,
      ...(target === undefined ? {} : { target }),
      nodeKind: "action",
      order: 20,
      disabled: view.disabled,
      // Reveal enabled actions on a watched vault/market subject (board-first, like observe/options).
      visible:
        !view.disabled &&
        (view.target?.subjectKind === "vault" || view.target?.subjectKind === "market"),
      ...(view.disabledReason === undefined ? {} : { disabledReason: view.disabledReason }),
      inputSchema: stewardInputSchema(view)
    },
    { package: PACKAGE, idPrefix: "action" }
  );
};

// --- helpers ---

const idSlug = (value: string): string => value.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 64);

const subjectGroupIdFor = (subjectId: string): string => `steward.subject.${idSlug(subjectId)}`;

const subjectLabel = (subject: StewardStateSnapshot["watchedSubjects"][number]): string => {
  switch (subject.kind) {
    case "market":
      return subject.marketId ?? subject.id;
    case "vault":
      return subject.vaultId ?? subject.id;
    case "steward":
      return `Steward ${subject.id}`;
    default:
      return subject.id;
  }
};

const stewardInputSchema = (view: StewardFunctionView): JsonSchema => {
  const properties: Array<NonNullable<JsonSchema["properties"]>[number]> = [
    {
      name: "subjectId",
      help: "Watched subject id the action targets.",
      value: { type: "string", required: true, description: "Subject id." }
    },
    {
      name: "subjectKind",
      help: "Disambiguates subjects that share an id (S5).",
      value: {
        type: "enum",
        description: "Subject kind.",
        values: ["market", "vault", "observer", "bookmaker", "steward", "evidence", "resolution"]
      }
    }
  ];

  // resolve carries the steward's YES/NO outcome (and an optional explicit vaultId).
  if (view.name === "resolve") {
    properties.push(
      {
        name: "outcome",
        help: "Resolution outcome the steward is calling.",
        value: { type: "enum", required: true, description: "Outcome (yes or no).", values: ["yes", "no"] }
      },
      {
        name: "vaultId",
        help: "Vault to resolve (defaults to the subject's vault).",
        value: { type: "string", description: "Vault id." }
      }
    );
  }

  properties.push(
    {
      name: "reason",
      help: "Operator-supplied justification recorded with the action.",
      value: { type: "string", required: view.name !== "ignore" && view.name !== "resolve", description: "Reason." }
    },
    {
      name: "findingId",
      help: "Optional finding this action responds to.",
      value: { type: "string", description: "Finding id." }
    }
  );

  return { type: "object", properties };
};

const toTarget = (view: StewardFunctionView): FunctionDescriptor["target"] => {
  if (view.target === undefined) {
    return undefined;
  }
  return {
    kind: view.target.kind,
    ...(view.target.vaultId === undefined ? {} : { vaultId: view.target.vaultId })
  };
};

const obj = (properties: JsonSchema["properties"]): JsonSchema => ({ type: "object", properties });

const CONFIGURE_INPUT_SCHEMA: JsonSchema = obj([
  {
    name: "marketId",
    value: { type: "string", description: "Market subject to watch." },
    help: "When set, steward watches the market subject with this id."
  },
  {
    name: "vaultId",
    value: { type: "string", description: "Vault subject to watch + resolve." },
    help: "When set, steward watches the vault subject so it can be resolved."
  }
]);

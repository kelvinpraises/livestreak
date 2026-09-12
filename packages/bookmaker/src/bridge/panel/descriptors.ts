// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// Track D: emit a configurator root (`bookmaker:config`) with configure + close, plus a global action
// group with `createVault` as a child. Every node carries id/parentId/package/visible via
// withDescriptorIdentity. Pure read/projection — no detect/decide/createVault changes.

import type { CapabilityScope, FunctionDescriptor, JsonSchema } from "@livestreak/schema";
import { bridgeActionScope, withDescriptorIdentity } from "@livestreak/schema";

import { bridgeControlsReadScope } from "../types.js";
import type { BookmakerPanelView } from "../../model/watch-source.js";

const PACKAGE = "bookmaker" as const;
const ROOT_ID = "bookmaker.root";
const CONFIG_ID = "bookmaker.config.configure";
const CLOSE_ID = "bookmaker.config.close";

// --- exports ---

export const projectBookmakerDescriptors = (
  panel: BookmakerPanelView
): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];

  pushRoot(descriptors);
  pushConfigurator(descriptors);
  descriptors.push(createVaultDescriptor(panel));

  return descriptors;
};

// --- tree nodes ---

// Single root pane: every action nests under one "Bookmaker" group so the console shows ONE clean
// section (not loose cards). Mirrors the uniform shape across packages.
const pushRoot = (descriptors: FunctionDescriptor[]): void => {
  descriptors.push(
    withDescriptorIdentity(
      {
        id: ROOT_ID,
        name: "bookmaker",
        label: "Bookmaker",
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
        label: "Configure bookmaker",
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

const createVaultDescriptor = (panel: BookmakerPanelView): FunctionDescriptor => {
  const hasMarket = panel.marketId.trim().length > 0;

  return withDescriptorIdentity(
    {
      id: `${ROOT_ID}.action.createVault`,
      parentId: ROOT_ID,
      name: "createVault",
      label: "Create vault",
      scope: `${bridgeActionScope}:createVault` as CapabilityScope,
      target: { kind: "vault", ...(hasMarket ? { marketId: panel.marketId } : {}) },
      nodeKind: "action",
      order: 20,
      disabled: !hasMarket,
      // Board-first reveal (like observe register): createVault lights up once configure sets a market.
      visible: hasMarket,
      ...(hasMarket ? {} : { disabledReason: "No market context" }),
      inputSchema: CREATE_VAULT_INPUT_SCHEMA
    },
    { package: PACKAGE, idPrefix: "action" }
  );
};

// --- schema builders ---

const required = true;

const str = (description: string): JsonSchema => ({ type: "string", required, description });

const obj = (properties: JsonSchema["properties"]): JsonSchema => ({ type: "object", properties });

const CONFIGURE_INPUT_SCHEMA: JsonSchema = obj([
  {
    name: "marketId",
    value: str("Market to originate vaults on."),
    help: "Market id (bytes32 hex) — supplied via configure, not auto-injected."
  },
  {
    name: "runId",
    value: str("Observe run id backing market context."),
    help: "Run id from the active observe session."
  }
]);

const CREATE_VAULT_INPUT_SCHEMA: JsonSchema = obj([
  {
    name: "marketId",
    value: str("Market the vault belongs to."),
    help: "Market id (bytes32 hex)."
  },
  {
    name: "question",
    value: str("Vault question / proposition."),
    help: "Human-readable yes/no proposition."
  },
  {
    name: "creatorSide",
    value: { type: "enum", required, values: ["yes", "no"], description: "Side the creator backs." },
    help: "Creator's initial side."
  },
  {
    name: "creatorStake",
    value: {
      type: "string",
      required,
      description: "Creator's opening stake. Base-unit integer as a decimal string."
    },
    help: "USDC base units staked by the creator."
  },
  {
    name: "seedRate",
    value: {
      type: "string",
      required,
      description: "Initial stream rate. Base-unit integer as a decimal string."
    },
    help: "USDC base units/sec seed rate."
  },
  {
    name: "resolutionSource",
    value: {
      type: "string",
      required,
      description: 'How the vault resolves (e.g. "manual").',
      default: "manual"
    },
    help: "Resolution source — defaults to manual."
  },
  {
    name: "resolutionWindowExpiresAtMs",
    value: {
      type: "integer",
      description: "Resolution deadline (epoch ms). Leave blank to default to 24h from now."
    },
    help: "Optional — the gateway defaults this to now + 24h when blank."
  }
]);

// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// WAVE 4: bookmaker's bridge exposes a single write action, `createVault`. This projects it into the
// canonical `@livestreak/schema` FunctionDescriptor with a real `inputSchema` mirroring the writer's
// `chains/types.ts` CreateVaultInput. Pure read/projection — no detect/decide/createVault changes.
//
// MULTICHAIN: descriptor shape is chain-agnostic; the marketId VALUE is resolved per chain at call
// time. bigint stakes/rates cross the wire as decimal strings (JSON has no bigint; the writer parses
// them back at call time).

import type { CapabilityScope, FunctionDescriptor, JsonSchema } from "@livestreak/schema";
import { bridgeActionScope } from "@livestreak/schema";

import type { BookmakerPanelView } from "../../model/watch-source.js";

// --- exports ---

export const projectBookmakerDescriptors = (
  panel: BookmakerPanelView
): readonly FunctionDescriptor[] => [createVaultDescriptor(panel)];

// --- helpers ---

const createVaultDescriptor = (panel: BookmakerPanelView): FunctionDescriptor => {
  const hasMarket = panel.marketId.trim().length > 0;

  return {
    name: "createVault",
    label: "Create vault",
    // Console scope-unification (wave 5): emit the granular `bridge:action:createVault` so the host
    // authorizes it directly (the coarse `bridge:action` over-granted under the depth-guarded matcher).
    scope: `${bridgeActionScope}:createVault` as CapabilityScope,
    target: { kind: "vault", ...(hasMarket ? { marketId: panel.marketId } : {}) },
    disabled: !hasMarket,
    ...(hasMarket ? {} : { disabledReason: "No market context" }),
    inputSchema: CREATE_VAULT_INPUT_SCHEMA
  };
};

const required = true;

// CreateVaultInput mirror.
const CREATE_VAULT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: [
    {
      name: "marketId",
      value: { type: "string", required, description: "Market the vault belongs to." },
      help: "Market id (bytes32 hex)."
    },
    {
      name: "question",
      value: { type: "string", required, description: "Vault question / proposition." },
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
    }
  ]
};

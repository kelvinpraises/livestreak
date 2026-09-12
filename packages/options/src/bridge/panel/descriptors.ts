// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// Flat model: one "Options" root group, with Configure + Close + every action as direct children.
// Actions reveal via `visible: configured && !disabled` (board-first). Every node carries
// id/parentId/package/visible via withDescriptorIdentity. Pure read/projection.

import type { CapabilityScope, FunctionDescriptor, JsonSchema } from "@livestreak/schema";
import { bridgeActionScope, withDescriptorIdentity } from "@livestreak/schema";

import { bridgeControlsReadScope } from "../types.js";
import type { OptionsFunctionView, OptionsPanel } from "./types.js";
import { projectOptionsFunctions } from "./project.js";

const PACKAGE = "options" as const;
const ROOT_ID = "options.root";
const CONFIG_ID = "options.config.configure";
const CLOSE_ID = "options.config.close";

// --- exports ---

export const projectOptionsDescriptors = (panel: OptionsPanel): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];
  const views = projectOptionsFunctions(panel);

  pushRoot(descriptors);
  pushConfigurator(descriptors);

  // Board-first: hide every action (even always-enabled globals like setApprovalForAll) until a market
  // is configured, so the pane shows only Configure + Close until you configure.
  const configured = panel.markets.length > 0;
  let order = 0;
  for (const view of views) {
    descriptors.push(toActionDescriptor(view, ROOT_ID, configured, order++));
  }

  return descriptors;
};

// --- tree nodes ---

// Single root pane: configure/close + all actions nest under one "Options" group.
const pushRoot = (descriptors: FunctionDescriptor[]): void => {
  descriptors.push(
    withDescriptorIdentity(
      {
        id: ROOT_ID,
        name: "options",
        label: "Options",
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
        label: "Configure options",
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

const toActionDescriptor = (
  view: OptionsFunctionView,
  parentId: string,
  configured: boolean,
  order: number
): FunctionDescriptor => {
  const inputSchema = OPTIONS_INPUT_SCHEMAS[view.name];
  const actionId = actionIdFor(parentId, view);

  return withDescriptorIdentity(
    {
      id: actionId,
      parentId,
      name: view.name,
      label: view.label,
      scope: `${bridgeActionScope}:${view.name}` as CapabilityScope,
      ...(view.target === undefined ? {} : { target: view.target }),
      nodeKind: "action",
      order,
      disabled: view.disabled,
      // Board-first reveal: an action lights up only after configure AND once its prerequisites exist.
      visible: configured && !view.disabled,
      ...(view.disabledReason === undefined ? {} : { disabledReason: view.disabledReason }),
      ...(inputSchema === undefined ? {} : { inputSchema })
    },
    { package: PACKAGE, idPrefix: "action" }
  );
};

// --- id helpers ---

const actionIdFor = (parentId: string, view: OptionsFunctionView): string => {
  const suffix =
    view.target?.side === undefined ? "" : `.${view.target.side}`;
  return `${parentId}.action.${view.name}${suffix}`;
};

// --- schema builders (canonical JsonSchema) ---

const required = true;

const str = (description: string): JsonSchema => ({ type: "string", required, description });

const sideEnum: JsonSchema = {
  type: "enum",
  required,
  values: ["yes", "no"],
  description: "Market side."
};

const bool = (description: string): JsonSchema => ({ type: "boolean", required, description });

const amountStr = (description: string): JsonSchema => ({
  type: "string",
  required,
  description: `${description} Base-unit integer as a decimal string.`
});

const obj = (properties: JsonSchema["properties"]): JsonSchema => ({ type: "object", properties });

const arrayOf = (items: JsonSchema, description: string): JsonSchema => ({
  type: "array",
  required,
  items,
  description
});

const CONFIGURE_INPUT_SCHEMA: JsonSchema = obj([
  {
    name: "marketId",
    value: str("Market to operate on."),
    help: "Market id (bytes32 hex) — supplied manually, not inferred from observe."
  }
]);

const OPTIONS_INPUT_SCHEMAS: Readonly<Record<string, JsonSchema>> = {
  mint: obj([
    { name: "marketId", value: str("Market to enter."), help: "Market id (bytes32 hex)." },
    { name: "to", value: str("NFT recipient."), help: "Recipient wallet address." }
  ]),
  mintWithSalt: obj([
    { name: "marketId", value: str("Market to enter."), help: "Market id (bytes32 hex)." },
    {
      name: "salt",
      value: {
        type: "integer",
        required,
        description: "Deterministic tokenId salt (uint64, 0 .. 2^64-1)."
      },
      help: "uint64 salt fed to calcTokenIdWithSalt for a deterministic tokenId."
    },
    { name: "to", value: str("NFT recipient."), help: "Recipient wallet address." }
  ]),
  fund: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault to fund."), help: "Target vault id." },
    { name: "side", value: sideEnum, help: "Side to back." },
    { name: "rate", value: amountStr("Per-second stream rate."), help: "Stream rate in USDC base units/sec." },
    { name: "deposit", value: amountStr("Initial deposit."), help: "Up-front deposit in USDC base units." }
  ]),
  setLanes: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    {
      name: "lanes",
      value: arrayOf(
        obj([
          { name: "vaultId", value: str("Vault id."), help: "Lane target vault." },
          { name: "side", value: sideEnum, help: "Lane side." },
          { name: "rate", value: amountStr("Lane stream rate."), help: "USDC base units/sec." }
        ]),
        "Full replacement set of lanes."
      ),
      help: "All lanes for the NFT (replaces existing)."
    },
    { name: "addDeposit", value: amountStr("Additional deposit."), help: "Extra USDC base units to add." }
  ]),
  addFunds: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "NFT whose shared balance to top up." },
    {
      name: "deposit",
      value: amountStr("Deposit to add."),
      help: "USDC base units added to the shared balance; existing lanes are preserved/revived."
    }
  ]),
  stopFunding: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Vault whose lane to stop." },
    { name: "side", value: sideEnum, help: "Side of the lane to stop." }
  ]),
  stopAllFunding: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Stop every active lane on this NFT." }
  ]),
  withdraw: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Vault to withdraw winnings from." },
    { name: "to", value: str("Payout recipient."), help: "Address receiving the payout." }
  ]),
  withdrawMany: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    {
      name: "vaultIds",
      value: arrayOf(str("Vault id."), "Vaults to withdraw from."),
      help: "List of vault ids to claim in one call."
    },
    { name: "to", value: str("Payout recipient."), help: "Address receiving the payouts." }
  ]),
  claimLossLvst: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Losing vault to claim LVST from." },
    { name: "side", value: sideEnum, help: "Losing side." },
    { name: "to", value: str("LVST recipient."), help: "Address receiving the LVST." }
  ]),
  stakeLvst: obj([
    { name: "amount", value: amountStr("LVST amount to stake."), help: "LVST base units." }
  ]),
  unstakeLvst: obj([
    { name: "amount", value: amountStr("LVST amount to unstake."), help: "LVST base units." }
  ]),
  transferNft: obj([
    { name: "from", value: str("Current owner."), help: "Address transferring the NFT." },
    { name: "to", value: str("New owner."), help: "Recipient address." },
    { name: "tokenId", value: str("Position NFT id."), help: "NFT to transfer." }
  ]),
  approveNft: obj([
    { name: "operator", value: str("Operator address."), help: "Address approved for the NFT." },
    { name: "tokenId", value: str("Position NFT id."), help: "NFT to approve." }
  ]),
  setApprovalForAll: obj([
    { name: "operator", value: str("Operator address."), help: "Address to grant/revoke." },
    { name: "approved", value: bool("Grant (true) or revoke (false)."), help: "Approval flag." }
  ])
};

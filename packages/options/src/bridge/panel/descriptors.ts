// Canonical FunctionDescriptor projection for the Remote Bridge Console auto-UI (Objective 4, P1).
//
// WAVE 4: every consumable bridge emits machine-readable descriptors so the remote console can
// auto-render forms. This projects options' dynamic functions[] (scope/label/target/disabled already
// resolved by project.ts) into the canonical `@livestreak/schema` FunctionDescriptor, replacing the
// degenerate `input: "<TypeName>"` string with a real `inputSchema: JsonSchema` that mirrors the
// writer's `chains/types.ts` input shape. Pure read/projection — no writer/correctness changes.
//
// MULTICHAIN: descriptors are chain-agnostic SHAPE only; field VALUES (ids, addresses) are resolved
// per chain at call time by the writer. bigint inputs are modelled as decimal-string `string` (JSON
// has no bigint; the writer parses them back via requirePositiveBigInt at call time).

import type { CapabilityScope, FunctionDescriptor, JsonSchema } from "@livestreak/schema";
import { bridgeActionScope } from "@livestreak/schema";

import type { OptionsFunctionView, OptionsPanel } from "./types.js";
import { projectOptionsFunctions } from "./project.js";

// --- exports ---

export const projectOptionsDescriptors = (panel: OptionsPanel): readonly FunctionDescriptor[] => {
  const descriptors: FunctionDescriptor[] = [];

  // project.ts' functions[] now emits BOTH `mint` and `mintWithSalt` (wave 5), so the descriptor
  // projection is a straight map — no special-casing.
  for (const view of projectOptionsFunctions(panel)) {
    descriptors.push(toDescriptor(view));
  }

  return descriptors;
};

// --- helpers ---

const toDescriptor = (view: OptionsFunctionView): FunctionDescriptor => {
  const inputSchema = OPTIONS_INPUT_SCHEMAS[view.name];

  return {
    name: view.name,
    label: view.label,
    // Console scope-unification (wave 5): emit the uniform granular console scope `bridge:action:<name>`
    // directly so the host authorizes the projected scope with NO downstream scope normalization. The
    // package-internal `view.scope` (options:<kind>:<name>) stays in the legacy functions[] catalog.
    scope: `${bridgeActionScope}:${view.name}` as CapabilityScope,
    ...(view.target === undefined ? {} : { target: view.target }),
    disabled: view.disabled,
    ...(view.disabledReason === undefined ? {} : { disabledReason: view.disabledReason }),
    ...(inputSchema === undefined ? {} : { inputSchema })
  };
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

// bigint base-unit amounts cross the wire as decimal strings (JSON has no bigint).
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

// Each schema mirrors the matching `chains/types.ts` writer input exactly.
const OPTIONS_INPUT_SCHEMAS: Readonly<Record<string, JsonSchema>> = {
  // MintNftInput
  mint: obj([
    { name: "marketId", value: str("Market to enter."), help: "Market id (bytes32 hex)." },
    { name: "to", value: str("NFT recipient."), help: "Recipient wallet address." }
  ]),
  // MintWithSaltInput — salt is `uint64` per the MarketDriver ABI + CLI lane (NOT bytes32 hex; the
  // options MintWithSaltInput.salt:string comment is doc drift, the contract wins). Modelled as a
  // numeric `integer` (uint64 range) so the auto-form renders a number input.
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
  // FundStreamInput
  fund: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault to fund."), help: "Target vault id." },
    { name: "side", value: sideEnum, help: "Side to back." },
    { name: "rate", value: amountStr("Per-second stream rate."), help: "Stream rate in USDC base units/sec." },
    { name: "deposit", value: amountStr("Initial deposit."), help: "Up-front deposit in USDC base units." }
  ]),
  // SetLanesInput
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
  // StopFundingInput
  stopFunding: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Vault whose lane to stop." },
    { name: "side", value: sideEnum, help: "Side of the lane to stop." }
  ]),
  // StopAllFundingInput
  stopAllFunding: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Stop every active lane on this NFT." }
  ]),
  // WithdrawInput
  withdraw: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Vault to withdraw winnings from." },
    { name: "to", value: str("Payout recipient."), help: "Address receiving the payout." }
  ]),
  // WithdrawManyInput
  withdrawMany: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    {
      name: "vaultIds",
      value: arrayOf(str("Vault id."), "Vaults to withdraw from."),
      help: "List of vault ids to claim in one call."
    },
    { name: "to", value: str("Payout recipient."), help: "Address receiving the payouts." }
  ]),
  // ClaimLossLvstInput
  claimLossLvst: obj([
    { name: "tokenId", value: str("Position NFT id."), help: "Owned position NFT token id." },
    { name: "vaultId", value: str("Vault id."), help: "Losing vault to claim LVST from." },
    { name: "side", value: sideEnum, help: "Losing side." },
    { name: "to", value: str("LVST recipient."), help: "Address receiving the LVST." }
  ]),
  // StakeLvstInput
  stakeLvst: obj([
    { name: "amount", value: amountStr("LVST amount to stake."), help: "LVST base units." }
  ]),
  // UnstakeLvstInput
  unstakeLvst: obj([
    { name: "amount", value: amountStr("LVST amount to unstake."), help: "LVST base units." }
  ]),
  // claimDividends() takes no input — intentionally omitted (no inputSchema).
  // TransferNftInput
  transferNft: obj([
    { name: "from", value: str("Current owner."), help: "Address transferring the NFT." },
    { name: "to", value: str("New owner."), help: "Recipient address." },
    { name: "tokenId", value: str("Position NFT id."), help: "NFT to transfer." }
  ]),
  // ApproveNftInput
  approveNft: obj([
    { name: "operator", value: str("Operator address."), help: "Address approved for the NFT." },
    { name: "tokenId", value: str("Position NFT id."), help: "NFT to approve." }
  ]),
  // SetApprovalForAllInput
  setApprovalForAll: obj([
    { name: "operator", value: str("Operator address."), help: "Address to grant/revoke." },
    { name: "approved", value: bool("Grant (true) or revoke (false)."), help: "Approval flag." }
  ])
};

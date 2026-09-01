// --- exports ---

export type ContractSide = "yes" | "no";

export const sideToSolidityValue = (side: ContractSide): 0 | 1 =>
  side === "yes" ? 0 : 1;

export const sideFromSolidityValue = (value: number): ContractSide => {
  if (value === 0) {
    return "yes";
  }

  if (value === 1) {
    return "no";
  }

  throw new Error(`Invalid Side enum value: ${value}`);
};

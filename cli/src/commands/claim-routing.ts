/** Pure claim action routing for the CLI (win vs loss). */
export const routeClaimAction = (loss: boolean): "withdraw" | "claimLossLvst" =>
  loss ? "claimLossLvst" : "withdraw";

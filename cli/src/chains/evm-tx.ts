import type { WalletAccountEvmErc4337 } from "@livestreak/wallet";
import { encodeFunctionData, erc20Abi, type Abi, type PublicClient } from "viem";

export const pollUntilUserOperationIncluded = async (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Promise<unknown> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await readOnly.getUserOperationReceipt(userOpHash);
    if (receipt !== null && receipt !== undefined) {
      assertUserOperationSucceeded(receipt);
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for UserOperation receipt for ${userOpHash}`);
};

const assertUserOperationSucceeded = (receipt: unknown): void => {
  if (typeof receipt !== "object" || receipt === null) {
    throw new Error("UserOperation receipt payload is not an object");
  }

  const success = (receipt as Record<string, unknown>)["success"];
  if (typeof success !== "boolean") {
    throw new Error("UserOperation receipt is missing success");
  }

  if (success === false) {
    throw new Error("UserOperation included but reverted");
  }
};

export const readUserOpTransactionHash = (receipt: unknown): `0x${string}` => {
  if (typeof receipt !== "object" || receipt === null) {
    throw new Error("UserOperation receipt payload is not an object");
  }

  const record = receipt as Record<string, unknown>;
  const nested = record["receipt"];
  const direct = record["transactionHash"];

  if (typeof direct === "string" && direct.startsWith("0x")) {
    return direct as `0x${string}`;
  }

  if (typeof nested === "object" && nested !== null) {
    const txHash = (nested as Record<string, unknown>)["transactionHash"];
    if (typeof txHash === "string" && txHash.startsWith("0x")) {
      return txHash as `0x${string}`;
    }
  }

  throw new Error("UserOperation receipt is missing transactionHash");
};

export const sendContractCall = async (
  account: WalletAccountEvmErc4337,
  to: `0x${string}`,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = []
): Promise<{ readonly userOpHash: string; readonly userOpReceipt: unknown }> => {
  const data = encodeFunctionData({
    abi,
    functionName,
    args: args as readonly unknown[] | undefined
  });

  const sendResult = await account.sendTransaction({
    to,
    data,
    value: 0n
  });

  const readOnly = await account.toReadOnlyAccount();
  const userOpReceipt = await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
  return { userOpHash: sendResult.hash, userOpReceipt };
};

export const ensureErc20Approval = async (
  account: WalletAccountEvmErc4337,
  publicClient: PublicClient,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<string | undefined> => {
  const owner = (await account.getAddress()) as `0x${string}`;
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender]
  });

  if (allowance >= amount) {
    return undefined;
  }

  const { userOpHash } = await sendContractCall(account, token, erc20Abi, "approve", [
    spender,
    amount
  ]);

  return userOpHash;
};

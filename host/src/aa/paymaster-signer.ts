import { privateKeyToAccount } from "viem/accounts";
import {
  concat,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toBytes,
  type Hex
} from "viem";

// --- exports ---

export interface PackedUserOp {
  readonly sender: Hex;
  readonly nonce: Hex;
  readonly callData: Hex;
  readonly callGasLimit: Hex;
  readonly verificationGasLimit: Hex;
  readonly preVerificationGas: Hex;
  readonly maxFeePerGas: Hex;
  readonly maxPriorityFeePerGas: Hex;
  readonly factory?: Hex | null;
  readonly factoryData?: Hex | null;
  readonly paymaster?: Hex | null;
  readonly paymasterData?: Hex | null;
  readonly paymasterVerificationGasLimit?: Hex | null;
  readonly paymasterPostOpGasLimit?: Hex | null;
  readonly signature: Hex;
}

export interface PaymasterSignResult {
  readonly paymaster: Hex;
  readonly paymasterData: Hex;
  readonly paymasterVerificationGasLimit: Hex;
  readonly paymasterPostOpGasLimit: Hex;
}

const PM_VERIFICATION_GAS = "0x30000" as Hex;
const PM_POSTOP_GAS = "0x10000" as Hex;

export const createPaymasterSigner = (executorKey: Hex, paymasterAddress: Hex) => {
  const account = privateKeyToAccount(executorKey);

  const getHash = (
    userOp: PackedUserOp,
    validUntil: number,
    validAfter: number,
    chainId: bigint
  ): Hex => {
    const initCode =
      userOp.factory && userOp.factoryData
        ? concat([userOp.factory, userOp.factoryData])
        : ("0x" as Hex);

    const accountGasLimits = encodePacked(
      ["uint128", "uint128"],
      [BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit)]
    );

    const gasFees = encodePacked(
      ["uint128", "uint128"],
      [BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas)]
    );

    const paymasterGasLimits = encodePacked(
      ["uint128", "uint128"],
      [BigInt(PM_VERIFICATION_GAS), BigInt(PM_POSTOP_GAS)]
    );

    return keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "address, uint256, bytes32, bytes32, bytes32, uint256, uint256, bytes32, uint256, address, uint48, uint48"
        ),
        [
          userOp.sender,
          BigInt(userOp.nonce),
          keccak256(initCode),
          keccak256(userOp.callData),
          accountGasLimits as Hex,
          BigInt(paymasterGasLimits),
          BigInt(userOp.preVerificationGas),
          gasFees as Hex,
          chainId,
          paymasterAddress,
          validUntil,
          validAfter
        ]
      )
    );
  };

  return {
    address: paymasterAddress,

    async signStub(): Promise<PaymasterSignResult> {
      const dummyOp: PackedUserOp = {
        sender: "0x0000000000000000000000000000000000000000" as Hex,
        nonce: "0x0" as Hex,
        callData: "0x" as Hex,
        callGasLimit: "0x0" as Hex,
        verificationGasLimit: "0x0" as Hex,
        preVerificationGas: "0x0" as Hex,
        maxFeePerGas: "0x0" as Hex,
        maxPriorityFeePerGas: "0x0" as Hex,
        signature: "0x" as Hex
      };
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      const hash = getHash(dummyOp, validUntil, 0, 31337n);
      const signature = await account.signMessage({ message: { raw: toBytes(hash) } });
      const timeData = encodeAbiParameters(parseAbiParameters("uint48, uint48"), [validUntil, 0]);
      return {
        paymaster: paymasterAddress,
        paymasterData: concat([timeData, signature]),
        paymasterVerificationGasLimit: PM_VERIFICATION_GAS,
        paymasterPostOpGasLimit: PM_POSTOP_GAS
      };
    },

    async signFromUserOp(
      userOp: PackedUserOp,
      _entryPoint: Hex,
      chainId: Hex
    ): Promise<PaymasterSignResult> {
      const validAfter = 0;
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      const hash = getHash(userOp, validUntil, validAfter, BigInt(chainId));
      const signature = await account.signMessage({ message: { raw: toBytes(hash) } });
      const timeData = encodeAbiParameters(parseAbiParameters("uint48, uint48"), [
        validUntil,
        validAfter
      ]);
      return {
        paymaster: paymasterAddress,
        paymasterData: concat([timeData, signature]),
        paymasterVerificationGasLimit: PM_VERIFICATION_GAS,
        paymasterPostOpGasLimit: PM_POSTOP_GAS
      };
    }
  };
};

export type PaymasterSigner = ReturnType<typeof createPaymasterSigner>;

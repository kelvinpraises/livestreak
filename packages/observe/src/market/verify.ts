import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import type {
  DecodedMarketRegistered,
  EvmAddress,
  StreamId,
  VerifiedMarketRegistration
} from "./types.js";

export interface VerifyMarketRegistrationInput {
  readonly decoded: DecodedMarketRegistered;
  readonly expectedStreamId: StreamId;
  readonly sender: EvmAddress;
  readonly expectedSender: EvmAddress;
  readonly userOpHash: string;
}

export const verifyMarketRegistration = (
  input: VerifyMarketRegistrationInput
): Effect.Effect<VerifiedMarketRegistration, LiveStreakConfigError> => {
  if (normalizeAddress(input.sender) !== normalizeAddress(input.expectedSender)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `MarketRegistered sender ${input.sender} does not match expected AA account ${input.expectedSender}`
      })
    );
  }

  if (normalizeBytes32(input.decoded.streamId) !== normalizeBytes32(input.expectedStreamId)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `MarketRegistered streamId ${input.decoded.streamId} does not match expected ${input.expectedStreamId}`
      })
    );
  }

  return Effect.succeed({
    marketId: input.decoded.marketId,
    streamId: input.decoded.streamId,
    title: input.decoded.title,
    userOpHash: input.userOpHash,
    sender: input.sender
  });
};

export const decodeMarketRegisteredPayload = (payload: {
  readonly marketId: string;
  readonly streamId: string;
  readonly title: string;
}): DecodedMarketRegistered => ({
  marketId: normalizeBytes32(payload.marketId),
  streamId: normalizeBytes32(payload.streamId),
  title: payload.title
});

// --- helpers ---

const normalizeAddress = (value: string): string => value.toLowerCase();

const normalizeBytes32 = (value: string): StreamId => {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return `0x${hex.padStart(64, "0").slice(-64)}` as StreamId;
};

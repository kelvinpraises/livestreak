import {
  isLiveStreakError,
  serializeLiveStreakError,
  serializeUnknownError,
  type SerializedError
} from "@livestreak/core";

// --- exports ---

export interface JsonSuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly body: T;
}

export interface JsonFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: SerializedError;
}

export type JsonResponse<T> = JsonSuccess<T> | JsonFailure;

export const jsonSuccess = <T>(status: number, body: T): JsonSuccess<T> => ({
  ok: true,
  status,
  body
});

export const jsonFailure = (status: number, error: unknown): JsonFailure => ({
  ok: false,
  status,
  error: isLiveStreakError(error)
    ? serializeLiveStreakError(error)
    : serializeUnknownError(error)
});

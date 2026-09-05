import {
  isLiveStreakError,
  serializeLiveStreakError,
  serializeUnknownError
} from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";

// --- exports ---

export type RouteResult<T> =
  | { readonly ok: true; readonly result: T; readonly status?: number }
  | { readonly ok: false; readonly status: number; readonly error: unknown };

export const sendRouteResult = <T>(
  res: Response,
  result: RouteResult<T>,
  next: NextFunction,
  defaultStatus = 200
): void => {
  if (result.ok) {
    res.status(result.status ?? defaultStatus).json(result.result);
    return;
  }

  if (isLiveStreakError(result.error)) {
    res.status(result.status).json({ error: serializeLiveStreakError(result.error) });
    return;
  }

  next(result.error);
};

export const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
  ): ((req: Request, res: Response, next: NextFunction) => void) =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

export const param = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
